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
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      subscriptionEndpointSecret,
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotencia
  if (await StripeEvent.findOne({ where: { event_id: event.id } }))
    return res.status(200).json({ received: true });

  const data = event.data.object;
  // console.log(data.parent?.subscription_details.subscription, "la data");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        if (data.mode !== "subscription") break;

        const existingSub = await Subscription.findOne({
          where: { userId: data.metadata.userId },
        });

        if (existingSub) {
          // Usuario ya tenía suscripción (ej: abrió dos checkouts) — solo actualizamos
          await existingSub.update({
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
          });
        }

        await User.update(
          { isSubscribed: true },
          { where: { id: data.metadata.userId } },
        );
        break;
      }

      case "invoice.payment_succeeded": {
        if (data.billing_reason === "subscription_create") break;

        // Stripe lo puede traer en diferentes lugares según la versión de la API
        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;

        console.log("subscriptionId resuelto:", subscriptionId);

        if (!subscriptionId) {
          console.warn(
            "⚠️ invoice.payment_succeeded sin subscription_id, ignorando",
          );
          break;
        }

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
        });

        await User.update(
          { isSubscribed: true },
          { where: { stripe_id: data.customer } },
        );
        break;
      }

      case "invoice.payment_failed": {
        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;

        if (!subscriptionId) {
          console.warn(
            "⚠️ invoice.payment_failed sin subscription_id, ignorando",
          );
          break;
        }

        await Subscription.update(
          { status: "past_due" },
          { where: { stripe_subscription_id: subscriptionId } },
        );
        break;
      }

      case "customer.subscription.updated": {
        const dbSub = await Subscription.findOne({
          where: { stripe_subscription_id: data.id },
        });
        if (!dbSub) break;

        const status = data.status;
        const isCancelling = data.cancel_at_period_end;
        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        await dbSub.update({
          status: status,
          next_renewal: isCancelling
            ? null
            : stripePeriodEnd
              ? moment.unix(stripePeriodEnd).tz(timezone).toDate()
              : null,
          will_cancel_at: data.cancel_at
            ? moment.unix(data.cancel_at).toDate()
            : null,
        });

        if (status === "active") {
          await User.update(
            { isSubscribed: true },
            { where: { stripe_id: data.customer } },
          );
        } else if (["canceled", "unpaid"].includes(status)) {
          await User.update(
            { isSubscribed: false },
            { where: { stripe_id: data.customer } },
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = await Subscription.findOne({
          where: { stripe_subscription_id: data.id },
        });
        console.log(
          "sub encontrada:",
          sub ? sub.stripe_subscription_id : "NO ENCONTRADA",
        );

        if (!sub) {
          // Aun así apagamos el acceso por customer_id como fallback
          await User.update(
            { isSubscribed: false },
            { where: { stripe_id: data.customer } },
          );
          break;
        }

        await sub.update({ status: "canceled", ended_at: new Date() });
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
    console.error(`❌ Error Webhook ${event.type}:`, error);
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
