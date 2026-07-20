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
const sendTicketEmailOpen = require("../helpers/sendTicketMailOpen");
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
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      subscriptionEndpointSecret,
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Idempotencia — ignorar eventos ya procesados
  if (await StripeEvent.findOne({ where: { event_id: event.id } }))
    return res.status(200).json({ received: true });

  const data = event.data.object;

  try {
    switch (event.type) {
      /* ══════════════════════════════════════════════════
       * 0. ¡NUEVO! CUALQUIER CHECKOUT EXPIRADO / ABANDONADO
       *    Si la sesión de Stripe expira y estaba pendiente,
       *    la borramos físicamente para no generar basura.
       * ══════════════════════════════════════════════════ */
      case "checkout.session.expired": {
        if (data.mode !== "subscription") break;

        // Buscamos si existe un registro pendiente para ese usuario
        const pendingSub = await Subscription.findOne({
          where: {
            userId: data.metadata.userId,
            status: "pending",
          },
        });

        if (pendingSub) {
          await pendingSub.destroy(); // 🗑️ Borrado físico
          console.log(
            `🗑️ Registro 'pending' eliminado por abandono de Checkout. Usuario: ${data.metadata.userId}`,
          );
        }
        break;
      }

      /* ══════════════════════════════════════════════════
       * 1. CHECKOUT COMPLETADO → Primera suscripción
       * ══════════════════════════════════════════════════ */
      case "checkout.session.completed": {
        if (data.mode !== "subscription") break;

        const existingBySubId = await Subscription.findOne({
          where: { stripe_subscription_id: data.subscription },
        });

        if (existingBySubId) {
          await existingBySubId.update({
            stripe_customer_id: data.customer,
            status: "active",
            price_id: data.metadata.priceId,
          });
        } else {
          const existingByUser = await Subscription.findOne({
            where: {
              userId: data.metadata.userId,
              status: "pending",
            },
          });

          if (existingByUser) {
            await existingByUser.update({
              stripe_subscription_id: data.subscription,
              stripe_customer_id: data.customer,
              status: "active",
              price_id: data.metadata.priceId,
            });
          } else {
            await Subscription.create({
              userId: data.metadata.userId,
              stripe_subscription_id: data.subscription,
              stripe_customer_id: data.customer,
              status: "active",
              price_id: data.metadata.priceId,
              subscription_type: "RECURRING",
            });
          }
        }

        await User.update(
          { isSubscribed: true },
          { where: { id: data.metadata.userId } },
        );
        break;
      }

      /* ══════════════════════════════════════════════════
       * 2. PAGO DE RENOVACIÓN EXITOSO
       * ══════════════════════════════════════════════════ */
      case "invoice.payment_succeeded": {
        if (data.billing_reason === "subscription_create") break;

        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;
        if (!subscriptionId) break;

        const sub = await Subscription.findOne({
          where: { stripe_subscription_id: subscriptionId },
        });
        if (!sub) break;

        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);

        await sub.update({
          status: "active",
          next_renewal: stripeSub.current_period_end
            ? moment.unix(stripeSub.current_period_end).tz(timezone).toDate()
            : null,
          will_cancel_at: null,
          ended_at: null,
        });

        await User.update(
          { isSubscribed: true },
          { where: { stripe_id: data.customer } },
        );
        break;
      }

      /* ══════════════════════════════════════════════════
       * 2.5 CREACIÓN DE LA SUSCRIPCIÓN (En Stripe empieza incompleta)
       * ══════════════════════════════════════════════════ */
      case "customer.subscription.created": {
        const user = await User.findOne({
          where: { stripe_id: data.customer },
        });
        if (!user) break;

        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        await Subscription.findOrCreate({
          where: { stripe_subscription_id: data.id },
          defaults: {
            userId: user.id,
            stripe_subscription_id: data.id,
            stripe_customer_id: data.customer,
            status: data.status, // Guardará 'incomplete'
            price_id: data.items?.data[0]?.price?.id,
            subscription_type: "RECURRING",
            next_renewal: stripePeriodEnd
              ? moment.unix(stripePeriodEnd).tz(timezone).toDate()
              : null,
          },
        });
        break;
      }

      /* ══════════════════════════════════════════════════
       * 3. PAGO FALLIDO
       * ══════════════════════════════════════════════════ */
      case "invoice.payment_failed": {
        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;
        if (!subscriptionId) break;

        const subActual = await Subscription.findOne({
          where: { stripe_subscription_id: subscriptionId },
        });

        if (!subActual) break;
        if (subActual.status === "canceled") break;

        await subActual.update({ status: "past_due" });
        break;
      }

      /* ══════════════════════════════════════════════════
       * 4. SUSCRIPCIÓN ACTUALIZADA → ¡OPTIMIZADO PARA LIMPIEZA!
       * ══════════════════════════════════════════════════ */
      case "customer.subscription.updated": {
        const status = data.status;

        // 🚨 SI STRIPE DICE QUE EXPIRÓ SIN COMPLETARSE (Basura): ¡LA BORRAMOS!
        if (status === "incomplete_expired") {
          const subBasura = await Subscription.findOne({
            where: { stripe_subscription_id: data.id },
          });
          if (subBasura) {
            await subBasura.destroy(); // 🗑️ Eliminación física fulminante
            console.log(
              `🗑️ Eliminada suscripción expirada de la BD: ${data.id}`,
            );
          }

          await User.update(
            { isSubscribed: false },
            { where: { stripe_id: data.customer } },
          );
          break; // Terminamos el caso aquí para que no intente hacer el upsert de abajo
        }

        const user = await User.findOne({
          where: { stripe_id: data.customer },
        });
        if (!user) break;

        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        const [dbSub, created] = await Subscription.findOrCreate({
          where: { stripe_subscription_id: data.id },
          defaults: {
            userId: user.id,
            stripe_subscription_id: data.id,
            stripe_customer_id: data.customer,
            status,
            price_id: data.items?.data[0]?.price?.id,
            subscription_type: "RECURRING",
            next_renewal: stripePeriodEnd
              ? moment.unix(stripePeriodEnd).tz(timezone).toDate()
              : null,
          },
        });

        if (!created) {
          await dbSub.update({
            status,
            next_renewal: stripePeriodEnd
              ? moment.unix(stripePeriodEnd).tz(timezone).toDate()
              : null,
            will_cancel_at: data.cancel_at
              ? moment.unix(data.cancel_at).tz(timezone).toDate()
              : null,
            ended_at: data.cancel_at_period_end ? dbSub.ended_at : null,
          });
        }

        const statusConAcceso = ["active", "trialing", "past_due"];
        const statusSinAcceso = ["canceled", "unpaid"];

        if (statusConAcceso.includes(status)) {
          await User.update(
            { isSubscribed: true },
            { where: { stripe_id: data.customer } },
          );
        } else if (statusSinAcceso.includes(status)) {
          await User.update(
            { isSubscribed: false },
            { where: { stripe_id: data.customer } },
          );
        }
        break;
      }

      /* ══════════════════════════════════════════════════
       * 5. SUSCRIPCIÓN CANCELADA DEFINITIVAMENTE O INCOMPLETA QUE EXPIRÓ
       * ══════════════════════════════════════════════════ */
      case "customer.subscription.deleted": {
        const sub = await Subscription.findOne({
          where: { stripe_subscription_id: data.id },
        });

        if (sub) {
          // 🚨 SI LA SUSCRIPCIÓN NUNCA SE PAGÓ (estaba incomplete) Y SE ELIMINA: ¡ES BASURA!
          if (
            sub.status === "incomplete" ||
            data.status === "incomplete_expired"
          ) {
            await sub.destroy(); // 🗑️ Borrado físico
            console.log(
              `🗑️ Eliminada suscripción muerta desde subscription.deleted: ${data.id}`,
            );
          } else {
            // Si era un cliente activo que simplemente canceló su servicio, sí lo marcamos como cancelado
            await sub.update({
              status: "canceled",
              ended_at: new Date(),
              will_cancel_at: null,
              next_renewal: null,
            });
          }
        }

        await User.update(
          { isSubscribed: false },
          { where: { stripe_id: data.customer } },
        );
        break;
      }
    }

    await StripeEvent.create({ event_id: event.id, type: event.type });
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(`❌ Error procesando webhook ${event.type}:`, error);
    // ✅ Retornamos 500 para que Stripe reintente el webhook
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
    console.error("❌ Firma inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    console.log("ℹ️ Evento ignorado:", event.type);
    return res.json({ received: true });
  }

  const session = event.data.object;

  if (session.metadata?.flow !== "VENTA_TICKET") {
    console.log("🔒 Evento ignorado (no es ticket)");
    return res.json({ received: true });
  }

  if (session.mode !== "payment") {
    console.log("🔒 No es pago único, ignorado.");
    return res.json({ received: true });
  }

  const { ticketIds, eventId, buyerEmail, buyerName, origin } =
    session.metadata ?? {};

  if (!ticketIds || !eventId || !buyerEmail) {
    console.error("❌ Metadata incompleta:", session.metadata);
    return res.status(400).json({ error: "Metadata incompleta" });
  }

  const ids = ticketIds.split(",").map(Number);
  const t = await sequelize.transaction();

  try {
    const tickets = await Ticket.findAll({
      where: { id: ids, sold: false },
      lock: t.LOCK.UPDATE, // ← corregido también
      transaction: t,
    });

    if (tickets.length === 0) {
      await t.rollback();
      console.log("⚠️ Tickets ya procesados (idempotente)");
      return res.json({ received: true });
    }

    // ✅ Marcar como vendidos
    await Promise.all(
      tickets.map((ticket) =>
        ticket.update(
          {
            sold: true,
            reserved: false,
            reservation_expires_at: null,
            buyerName,
            buyerEmail,
            stripeSessionId: session.id,
          },
          { transaction: t },
        ),
      ),
    );

    await t.commit();
    console.log(`🎉 ${tickets.length} ticket(s) vendidos: #${ids.join(", #")}`);

    // ✅ Datos del evento y usuario DESPUÉS del commit
    const [evento, usuario] = await Promise.all([
      Event.findByPk(eventId),
      User.findOne({ where: { email: buyerEmail } }),
    ]);

    // ✅ UN solo correo de confirmación
    if (origin === "OPEN") {
      try {
        await sendTicketEmailOpen(
          tickets,
          evento,
          usuario ?? { email: buyerEmail, name: buyerName },
        );
      } catch (emailErr) {
        console.error("⚠️ Email falló, tickets ya vendidos:", emailErr);
      }
    } else {
      try {
        await sendTicketEmail(
          tickets,
          evento,
          usuario ?? { email: buyerEmail, name: buyerName },
        );
      } catch (emailErr) {
        console.error("⚠️ Email falló, tickets ya vendidos:", emailErr);
      }
    }

    // ✅ Socket
    if (req.io) {
      req.io.emit("ticketSold", {
        ticketIds: ids,
        eventId,
        buyerName,
        quantity: ids.length,
      });
    }

    return res.json({ received: true });
  } catch (err) {
    await t.rollback();
    console.error("💥 Error ticket webhook:", err);
    return res.status(500).json({ error: "Internal error" });
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
