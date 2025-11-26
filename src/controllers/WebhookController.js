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
} = require("../models");
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
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      subscriptionEndpointSecret
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  try {
    switch (event.type) {
      /* ================================================= */
      /* 1) CHECKOUT SESSION COMPLETED                     */
      /* ================================================= */
      case "checkout.session.completed": {
        const session = data;

        if (!session.metadata || !session.metadata.userId) {
          return res.status(200).json({ received: true });
        }

        const { userId, priceId, subscriptionType } = session.metadata;

        const subscriptionId =
          session.mode === "subscription" ? session.subscription : null;

        // 👉 Crear registro en la BD (Stripe recomienda hacerlo aquí)
        await Subscription.create({
          stripe_checkout_session_id: session.id,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: session.customer,
          subscription_type: subscriptionType,
          price_id: priceId,
          userId,
          status: "active",
          start_date: now,
          end_date: subscriptionType === "ONETIME" ? getExpirationDate() : null,
          next_renewal:
            subscriptionType === "RECURRING"
              ? new Date(now.setDate(now.getDate() + 30))
              : null,
        });

        // 👉 Actualizar usuario
        const user = await User.findByPk(userId);
        if (user) {
          await user.update({
            isSubscribed: true,
            stripeSubscriptionId: subscriptionId,
          });
        }

        break;
      }

      /* ================================================= */
      /* 2) SUBSCRIPTION DELETED                           */
      /* ================================================= */
      case "customer.subscription.deleted": {
        const subscription = data;

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });

        if (subscriptionRecord) {
          await subscriptionRecord.update({
            status: "canceled",
            end_date: new Date(),
          });
        }

        const user = await User.findOne({
          where: { stripeSubscriptionId: subscription.id },
        });

        if (user) {
          await user.update({ isSubscribed: false });
        }

        break;
      }

      /* ================================================= */
      /* 3) SUBSCRIPTION UPDATED (Renewal, changes, etc)    */
      /* ================================================= */
      case "customer.subscription.updated": {
        const subscription = data;

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });

        if (subscriptionRecord) {
          await subscriptionRecord.update({
            status: subscription.status,
            next_renewal: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
          });
        }

        break;
      }

      /* ================================================= */
      default:
        console.log("Evento ignorado:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error procesando webhook:", error);
    return res.status(500).json({ error: "Internal Server Error" });
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
      orderPaymentsEndpointSecret
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
          { transaction: t }
        );

        // actualizar totales de la orden
        order.paidAmount = Number(order.paidAmount) + amount;
        order.remainingAmount = Math.max(
          0,
          Number(order.totalAmount) - order.paidAmount
        );
        order.status = order.remainingAmount <= 0 ? "pagado" : "activo";

        await order.save({ transaction: t });

        // Confirmar cambios
        await t.commit();

        console.log(
          `💵 Pago registrado y stock descontado para orden #${orderId}`
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
