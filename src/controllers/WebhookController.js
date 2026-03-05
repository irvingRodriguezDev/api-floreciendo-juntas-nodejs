const stripe = require("../config/stripe");
const {
  Subscription,
  User,
  Ticket,
  Event,
  Order,
  OrderPayment,
  OrderItem,
  Product,
  StripeEvent,
} = require("../models");
const moment = require("moment-timezone");
const sendTicketEmail = require("../helpers/sendTicketMail");
const sequelize = require("../config/db");
// NOTA: Asegúrate de que estas variables de entorno estén cargadas
const subscriptionEndpointSecret =
  process.env.STRIPE_WEBHOOK_SUBSCRIPTION_SECRET;
const ticketEndpointSecret = process.env.STRIPE_WEBHOOK_TICKET_SECRET;
const orderPaymentsEndpointSecret =
  process.env.STRIPE_WEBHOOK_PAYMENTS_ORDER_SECRET;

// 📅 Función para expiración de pago único (1 mes)
const getExpirationDate = () => {
  const now = new Date();
  now.setMonth(now.getMonth() + 1); // +30 días aprox
  return now;
};

/* -----------------------------
   📦 Webhook: SUSCRIPCIONES
   (Espera metadata: { userId, subscriptionType })
----------------------------- */
const handleSubscriptionStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const timezone = "America/Mexico_City";
  let event;

  try {
    // IMPORTANTE: req.body debe ser el buffer crudo (raw)
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      subscriptionEndpointSecret,
    );
  } catch (err) {
    console.error("⚠️ Error de firma de Webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  // 1️⃣ Idempotencia: Evitar procesar el mismo evento dos veces
  const alreadyProcessed = await StripeEvent.findOne({
    where: { event_id: event.id },
  });
  if (alreadyProcessed) return res.status(200).json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        if (data.mode !== "subscription") break;

        const { userId, priceId } = data.metadata;
        const stripeSubscriptionId = data.subscription;
        const stripeCustomerId = data.customer;

        // 1. Actualizar o crear la suscripción
        await Subscription.upsert({
          userId: userId,
          stripe_checkout_session_id: data.id,
          stripe_subscription_id: stripeSubscriptionId,
          stripe_customer_id: stripeCustomerId, // Nombre de campo según tu DB
          subscription_type: "RECURRING",
          price_id: priceId,
          status: "active",
          start_date: new Date(),
        });

        // 2. Actualizar el usuario con su stripe_id (vínculo maestro)
        await User.update(
          {
            isSubscribed: true,
            stripeSubscriptionId: stripeSubscriptionId,
            stripe_id: stripeCustomerId, // Usamos el campo stripe_id como pediste
          },
          { where: { id: userId } },
        );
        break;
      }

      case "invoice.payment_succeeded": {
        const subscriptionId =
          data.subscription ||
          data.lines?.data?.[0]?.parent?.subscription_item_details
            ?.subscription;

        if (!subscriptionId) break;

        const line = data.lines?.data?.[0];

        const nextRenewal = moment
          .unix(line?.period?.end)
          .tz(timezone)
          .toDate();

        // Actualizamos estado y fecha de renovación
        await Subscription.update(
          {
            status: "active",
            last_payment_at: data.status_transitions?.paid_at
              ? moment
                  .unix(data.status_transitions.paid_at)
                  .tz(timezone)
                  .toDate()
              : moment().tz(timezone).toDate(),
            next_renewal: nextRenewal,
          },
          { where: { stripe_subscription_id: subscriptionId } },
        );
        break;
      }

      case "invoice.payment_failed": {
        if (!data.subscription) break;

        // El pago falló, Stripe reintentará según tu configuración de "Smart Retries"
        await Subscription.update(
          { status: "past_due" },
          { where: { stripe_subscription_id: data.subscription } },
        );
        break;
      }

      case "customer.subscription.updated": {
        // 1. Detectamos si está programada para morir (Cancelación)
        const isCancelling = data.cancel_at_period_end; // true o false

        // 2. Si se va a cancelar, la "Próxima Renovación" ya no existe para nosotros
        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        const nextRenewalDate = isCancelling
          ? null // 👈 Si canceló, ponemos NULL para que el front no diga "Próximo cobro..."
          : stripePeriodEnd
            ? moment.unix(stripePeriodEnd).tz(timezone).toDate()
            : null;

        // 3. La fecha en la que dejará de tener acceso (will_cancel_at)
        // En Stripe es 'cancel_at'
        const willCancelDate = data.cancel_at
          ? moment.unix(data.cancel_at).tz(timezone).toDate()
          : null;

        await Subscription.update(
          {
            status: data.status,
            next_renewal: nextRenewalDate, // Ahora será NULL si el usuario canceló
            will_cancel_at: willCancelDate, // Se llenará con la fecha final
          },
          {
            where: { stripe_subscription_id: data.id },
          },
        );

        // 4. Manejo de bandera de suscripción (Solo si es cancelación inmediata o falta de pago)
        if (
          ["canceled", "unpaid", "incomplete_expired"].includes(data.status)
        ) {
          await User.update(
            { isSubscribed: false },
            { where: { stripe_id: data.customer } },
          );
        }
        if (data.status === "active") {
          await User.update(
            { isSubscribed: true },
            { where: { stripe_id: data.customer } },
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        // La suscripción se canceló definitivamente
        await Subscription.update(
          {
            status: "canceled",
            ended_at: new Date(),
            next_renewal: null,
          },
          { where: { stripe_subscription_id: data.id } },
        );

        // Quitar acceso al usuario usando su stripe_id
        await User.update(
          { isSubscribed: false, stripeSubscriptionId: null },
          { where: { stripe_id: data.customer } },
        );
        break;
      }
    }

    // Registrar evento procesado con éxito
    await StripeEvent.create({ event_id: event.id, type: event.type });
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(`❌ Error en Webhook (${event.type}):`, error);
    return res.status(500).send("Internal Server Error");
  }
};

/* -----------------------------
   🎟️ Webhook: TICKETS
   (Espera metadata: { ticketId, eventId, buyerName, buyerEmail })
----------------------------- */
const handleTicketStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, ticketEndpointSecret);

    console.log("🎟 Evento recibido TICKET:", event.type);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const session = event.data.object;

  // 🚫 FIREWALL → Blindaje absoluto del flujo
  if (session.metadata?.flow !== "VENTA_TICKET") {
    console.log("🔒 Evento ignorado (no es ticket)");
    return res.json({ received: true });
  }

  // 🚫 NO debe ser suscripción
  if (session.mode !== "payment") {
    console.log("🔒 No es pago único, ignorado.");
    return res.json({ received: true });
  }

  // SOLO queremos este evento
  if (event.type !== "checkout.session.completed") {
    console.log("ℹ️ Evento ignorado:", event.type);
    return res.json({ received: true });
  }

  try {
    const { ticketId, eventId, buyerEmail, buyerName } = session.metadata;

    const ticket = await Ticket.findByPk(ticketId);

    if (!ticket || ticket.sold) {
      console.log("⚠️ Ticket ya vendido o no existe");
      return res.json({ received: true });
    }

    ticket.sold = true;
    ticket.reserved = false;
    ticket.reservation_expires_at = null;
    await ticket.save();

    const evento = await Event.findByPk(eventId);
    const usuario = await User.findOne({ where: { email: buyerEmail } });

    await sendTicketEmail(ticket, evento, usuario);

    if (req.io) {
      req.io.emit("ticketSold", {
        ticketId,
        eventId,
        buyerName,
      });
    }

    console.log(`🎉 Ticket vendido #${ticket.id}`);
    res.json({ received: true });
  } catch (err) {
    console.error("💥 Error ticket webhook:", err);
    res.status(500).json({ error: "Internal error" });
  }
};

/*----------------------------
  🛍️ Webhook: PAGOS DE ÓRDENES (Salón)
  (Espera metadata: { orderId, type: 'initial'|'partial' })
------------------------------*/
const handleOrderPaymentStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      orderPaymentsEndpointSecret,
    );

    console.log("💰 Webhook ORDER PAYMENT:", event.type);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  // 🚫 Ignorar si NO es pago de orden
  if (data.metadata?.flow !== "ORDER_PAYMENT") {
    return res.json({ received: true });
  }

  // 🚫 Ignorar suscripciones
  if (data.mode === "subscription") {
    return res.json({ received: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const intent = data;

      const orderId = intent.metadata.orderId;
      const paymentType = intent.metadata.type;
      const reference = intent.payment_intent;
      const amount = Number(intent.amount_total / 100);

      // 🛑 Idempotencia: si ya existe un pago con este reference → ignorar
      const dup = await OrderPayment.findOne({ where: { reference } });
      if (dup) {
        console.log("🟡 Pago duplicado ignorado, REF:", reference);
        return res.json({ received: true });
      }

      // ============================================
      // 🧵 INICIO TRANSACCIÓN
      // ============================================
      const t = await sequelize.transaction();

      try {
        const order = await Order.findByPk(orderId, {
          include: [
            {
              model: OrderItem,
              as: "items",
              include: [{ model: Product, as: "product" }],
            },
          ],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!order) {
          await t.rollback();
          return res.json({ received: true });
        }
        // =========================
        //  🚚 SI EL PAGO ES DE ENVÍO
        // =========================
        if (paymentType === "shipping") {
          if (order.shippingPaid) {
            await t.rollback();
            return res.json({ received: true });
          }

          await OrderPayment.create(
            {
              orderId,
              amount,
              paymentDate: new Date(),
              paymentMethod: "tarjeta",
              status: "completado",
              type: "shipping",
              reference,
            },
            { transaction: t },
          );

          await order.update(
            { shippingPaid: true, status: "envio_pagado" },
            { transaction: t },
          );

          await t.commit();
          console.log(`🚚 Pago de envío registrado para la orden #${orderId}`);
          return res.json({ received: true });
        }

        // ============================================
        // 🔥 DESCONTAR STOCK (solo si NO se ha descontado antes)
        // ============================================
        if (!order.stockDiscounted) {
          for (const item of order.items) {
            const product = item.product;
            const newStock = Number(product.stock) - Number(item.quantity);
            if (newStock < 0) {
              await t.rollback();
              return res
                .status(400)
                .json({ error: `Stock insuficiente para ${product.name}` });
            }
            await product.update({ stock: newStock }, { transaction: t });
          }

          // marcar dentro de la transacción
          await order.update({ stockDiscounted: true }, { transaction: t });
        }

        // ============================================
        // 💵 Registrar el pago inicial o adicional
        // ============================================
        await OrderPayment.create(
          {
            orderId,
            amount,
            paymentDate: new Date(),
            paymentMethod: "tarjeta",
            status: "completado",
            type: paymentType,
            reference,
          },
          { transaction: t },
        );

        // actualizar totales de la orden
        order.paidAmount = Number(order.paidAmount) + amount;
        order.remainingAmount = Math.max(
          0,
          Number(order.totalAmount) - order.paidAmount,
        );
        order.status = order.remainingAmount <= 0 ? "pagado" : "activo";

        await order.save({ transaction: t });

        // Confirmar cambios
        await t.commit();

        console.log(
          `💵 Pago registrado y stock descontado para orden #${orderId}`,
        );
      } catch (err) {
        console.error("💥 Error dentro de la transacción:", err);
        await t.rollback();
        return res.status(500).json({ error: "Webhook transactional error" });
      }

      // ============================================
      // FIN
      // ============================================
    }

    res.json({ received: true });
  } catch (err) {
    console.error("💥 Error orden webhook:", err);
    res.status(500).json({ error: "Internal error" });
  }
};

module.exports = {
  handleSubscriptionStripeWebhook,
  handleTicketStripeWebhook,
  handleOrderPaymentStripeWebhook,
};
