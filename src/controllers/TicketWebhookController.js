// controllers/webhooks/bookingWebhookController.js
const stripe = require("../config/stripe");
const {
  sequelize,
  Booking,
  Ticket,
  PaymentTicket,
  Event,
} = require("../models");
const { sendBookingEmail } = require("../services/resendService");

const handleBookingStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_TICKET_SECRET,
    );
  } catch (err) {
    console.error("❌ Firma inválida de Webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ====================================================
  // MANEJO DE EXPIRACIÓN: "checkout.session.expired"
  // (Fichas de OXXO o sesiones de 24 horas no pagadas)
  // ====================================================
  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const { folio, paymentTicketId } = session.metadata ?? {};

    if (!folio) return res.json({ received: true });

    const tExp = await sequelize.transaction();
    try {
      const booking = await Booking.findOne({
        where: { folio },
        lock: tExp.LOCK.UPDATE,
        transaction: tExp,
      });

      // Solo cancelamos e invalidamos si la reserva sigue en PENDING (nunca se pagó el 1er cobro)
      if (booking && booking.status === "PENDING") {
        await booking.update(
          { status: "EXPIRED", checkoutUrl: null },
          { transaction: tExp },
        );

        // Marcar el intento de pago como cancelado
        if (paymentTicketId) {
          await PaymentTicket.update(
            {
              status: "CANCELLED",
              notes: "Expiró el tiempo límite de pago en Stripe/OXXO",
            },
            { where: { id: paymentTicketId }, transaction: tExp },
          );
        }

        // Liberar boletos bloqueados para que el público vuelva a comprarlos
        await Ticket.update(
          {
            reserved: false,
            reservation_expires_at: null,
            buyerName: null,
            buyerEmail: null,
            buyerPhone: null,
            bookingId: null,
            paymentStatus: "AVAILABLE",
          },
          { where: { bookingId: booking.id }, transaction: tExp },
        );

        console.log(
          `⏳ Reserva ${folio} liberada automáticamente por expiración.`,
        );
      }

      await tExp.commit();
      return res.json({ received: true });
    } catch (expErr) {
      await tExp.rollback();
      console.error("💥 Error procesando expiración de sesión:", expErr);
      return res.status(500).json({ error: "Error en expiración" });
    }
  }

  // ====================================================
  // MANEJO DE PAGOS EXITOSOS
  // ====================================================
  const isDirectSuccess = event.type === "checkout.session.completed";
  const isAsyncSuccess =
    event.type === "checkout.session.async_payment_succeeded";

  if (!isDirectSuccess && !isAsyncSuccess) {
    return res.json({ received: true });
  }

  const session = event.data.object;

  if (session.payment_status !== "paid") {
    console.log(
      `⏳ Pago pendiente de acreditación (ej. OXXO). Status: ${session.payment_status}`,
    );
    return res.json({ received: true });
  }

  const { folio, bookingId, flow, paymentType, paymentTicketId } =
    session.metadata ?? {};

  if (!folio && !bookingId) {
    console.log("🔒 Evento ignorado (Sin metadata de reserva)");
    return res.json({ received: true });
  }

  const t = await sequelize.transaction();

  try {
    // ----------------------------------------------------
    // CASO A: VENTA INICIAL (PAGO TOTAL O APARTADO 60%)
    // ----------------------------------------------------
    if (flow === "VENTA_TICKET" || flow === "APARTADO_TICKET") {
      const booking = await Booking.findOne({
        where: { folio },
        include: [
          { model: Ticket, as: "tickets", include: [{ model: Event }] },
        ],
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!booking || booking.status === "COMPLETED") {
        await t.rollback();
        console.log(`⚠️ Reserva ${folio} ya procesada o no encontrada.`);
        return res.json({ received: true });
      }

      const isFull = paymentType === "FULL";
      const amountPaid = parseFloat(session.amount_total) / 100;
      const paymentMethodUsed =
        session.payment_method_types?.[0] === "oxxo"
          ? "STRIPE_OXXO"
          : "STRIPE_CARD";

      // Nueva fecha límite para liquidar (10 días antes del evento)
      let newDueDate = null;
      if (!isFull) {
        const eventStartDate =
          booking.tickets?.[0]?.event?.startDate ||
          booking.tickets?.[0]?.Event?.startDate;

        if (eventStartDate) {
          const eventTime = new Date(eventStartDate).getTime();
          // Límite: 10 días antes del evento
          newDueDate = new Date(eventTime - 10 * 24 * 60 * 60 * 1000);
        }
      }

      // 1. Actualizar Reserva
      await booking.update(
        {
          status: isFull ? "COMPLETED" : "PARTIAL",
          approvalStatus: "APPROVED",
          paidAmount: booking.paidAmount + amountPaid,
          pendingAmount: isFull
            ? 0
            : Math.max(
                0,
                booking.totalAmount - (booking.paidAmount + amountPaid),
              ),
          paymentMethod: paymentMethodUsed,
          checkoutUrl: null,
          dueDate: newDueDate,
        },
        { transaction: t },
      );

      // 2. Actualizar el registro del PaymentTicket (de PENDING a APPROVED)
      const paymentWhere = paymentTicketId
        ? { id: paymentTicketId }
        : { bookingId: booking.id, status: "PENDING" };

      await PaymentTicket.update(
        {
          amount: amountPaid,
          paymentMethod: paymentMethodUsed,
          transactionRef: session.payment_intent,
          status: "APPROVED",
          paidAt: new Date(),
          notes: isFull
            ? "Pago total inicial vía Stripe"
            : "Pago inicial de apartado (60%) vía Stripe",
        },
        { where: paymentWhere, transaction: t },
      );

      // 3. Actualizar Boletos:
      // Si es FULL -> sold: true, paymentStatus: 'PAID'
      // Si es DEPOSIT -> sold: false (sigue en apartado), paymentStatus: 'PARTIALLY_PAID'
      await Ticket.update(
        {
          sold: isFull,
          reserved: !isFull,
          scanned: false,
          paymentStatus: isFull ? "PAID" : "PARTIALLY_PAID",
          reservation_expires_at: null, // Ya se pagó el apartado, cancelamos el timer de 24h
        },
        { where: { bookingId: booking.id }, transaction: t },
      );

      await t.commit();
      console.log(
        `🎉 Reserva ${folio} confirmada [${paymentType} - ${paymentMethodUsed}]`,
      );

      await processNotifications({ booking, flow, paymentType, req });
    }

    // ----------------------------------------------------
    // CASO B: LIQUIDACIÓN DEL SALDO RESTANTE (40%)
    // ----------------------------------------------------
    if (flow === "LIQUIDACION_TICKET" || flow === "LIQUIDACION_RESERVA") {
      const booking = await Booking.findByPk(bookingId, {
        include: [
          {
            model: Ticket,
            as: "tickets",
            include: [{ model: Event, attributes: ["id", "title"] }],
          },
        ],
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!booking || booking.pendingAmount === 0) {
        await t.rollback();
        console.log(
          `⚠️ Reserva #${bookingId} ya estaba completamente liquidada.`,
        );
        return res.json({ received: true });
      }

      const amountPaid = parseFloat(session.amount_total) / 100;
      const paymentMethodUsed =
        session.payment_method_types?.[0] === "oxxo"
          ? "STRIPE_OXXO"
          : "STRIPE_CARD";

      // 1. Actualizar estado de la Reserva a Liquidada
      await booking.update(
        {
          status: "COMPLETED",
          paidAmount: booking.totalAmount,
          pendingAmount: 0,
          checkoutUrl: null,
          dueDate: null,
        },
        { transaction: t },
      );

      // 2. Actualizar el registro del PaymentTicket de Liquidación
      const paymentWhere = paymentTicketId
        ? { id: paymentTicketId }
        : { bookingId: booking.id, status: "PENDING" };

      await PaymentTicket.update(
        {
          amount: amountPaid,
          paymentMethod: paymentMethodUsed,
          transactionRef: session.payment_intent,
          status: "APPROVED",
          paidAt: new Date(),
          notes: "Liquidación final (40%) vía Stripe",
        },
        { where: paymentWhere, transaction: t },
      );

      // 3. Marcar boletos oficialmente como VENDIDOS y PAGADOS al 100%
      await Ticket.update(
        {
          sold: true,
          reserved: false,
          paymentStatus: "PAID",
        },
        { where: { bookingId: booking.id }, transaction: t },
      );

      await t.commit();
      console.log(
        `🎉 Liquidación completada con éxito para folio: ${booking.folio}`,
      );

      await processNotifications({ booking, flow, paymentType, req });
    }

    return res.json({ received: true });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("💥 Error en handleBookingStripeWebhook:", err);
    return res.status(500).json({ error: "Error procesando webhook" });
  }
};

// 2. FUNCIÓN AUXILIAR DE NOTIFICACIONES (A nivel de módulo)
const processNotifications = async ({ booking, flow, paymentType, req }) => {
  try {
    const isFull = paymentType === "FULL";

    const eventTitle = booking.tickets?.[0]?.Event?.title;

    const payload = {
      email: booking.buyerEmail,
      buyerName: booking.buyerName,
      folio: booking.folio,
      eventTitle,
      tickets: booking.tickets,
      paidAmount: booking.paidAmount,
      pendingAmount: booking.pendingAmount,
      dueDate: booking.dueDate,
    };

    // Case 1: Compra Directa 100%
    if ((flow === "VENTA_TICKET" || flow === "APARTADO_TICKET") && isFull) {
      await sendBookingEmail({ type: 1, bookingData: payload });
    }

    // Case 2: Apartado del 60%
    if ((flow === "VENTA_TICKET" || flow === "APARTADO_TICKET") && !isFull) {
      await sendBookingEmail({ type: 2, bookingData: payload });
    }

    // Case 3: Liquidación Final del 40%
    if (flow === "LIQUIDACION_TICKET" || flow === "LIQUIDACION_RESERVA") {
      await sendBookingEmail({ type: 3, bookingData: payload });
    }

    // Notificación en tiempo real al Admin Panel vía WebSockets
    if (req.io) {
      req.io.emit("bookingUpdated", {
        folio: booking.folio,
        buyerName: booking.buyerName,
        status: booking.status,
      });
    }
  } catch (error) {
    // Se captura en un try/catch propio para que si el envío del correo falla,
    // NO marque error en la respuesta a Stripe (el pago ya se procesó con éxito en la BD)
    console.error("⚠️ Fallo no bloqueante en processNotifications:", error);
  }
};

module.exports = {
  handleBookingStripeWebhook,
};
