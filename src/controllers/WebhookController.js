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

  // ✅ Idempotencia — ignorar eventos ya procesados
  if (await StripeEvent.findOne({ where: { event_id: event.id } }))
    return res.status(200).json({ received: true });

  const data = event.data.object;

  try {
    switch (event.type) {
      /* ══════════════════════════════════════════════════
       * 1. CHECKOUT COMPLETADO → Primera suscripción
       *    Solo aplica cuando el modo es "subscription"
       * ══════════════════════════════════════════════════ */
      case "checkout.session.completed": {
        if (data.mode !== "subscription") break;

        // Primero buscar si ya existe esta sub específica
        const existingBySubId = await Subscription.findOne({
          where: { stripe_subscription_id: data.subscription },
        });

        if (existingBySubId) {
          // Ya existe (creada por subscription.updated), solo asegurar que esté active
          await existingBySubId.update({
            stripe_customer_id: data.customer,
            status: "active",
            price_id: data.metadata.priceId,
          });
        } else {
          // Buscar por userId para actualizar el registro pending del checkout
          const existingByUser = await Subscription.findOne({
            where: {
              userId: data.metadata.userId,
              status: "pending", // ← Solo tocar el que está pending
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
       *    billing_reason = "subscription_cycle" (renovación)
       *    Ignoramos "subscription_create" porque ya lo
       *    manejó checkout.session.completed
       * ══════════════════════════════════════════════════ */
      case "invoice.payment_succeeded": {
        if (data.billing_reason === "subscription_create") break;

        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;

        if (!subscriptionId) {
          console.warn(
            "⚠️ invoice.payment_succeeded sin subscriptionId, ignorando",
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
          will_cancel_at: null, // Por si reactivó después de past_due
          ended_at: null,
        });

        // ✅ Renovación exitosa → acceso garantizado
        await User.update(
          { isSubscribed: true },
          { where: { stripe_id: data.customer } },
        );
        break;
      }
      case "customer.subscription.created": {
        console.log("subscription created", data.id);
        // Reusar exactamente la misma lógica que updated
        // La forma más limpia: extraer el handler a una función

        const user = await User.findOne({
          where: { stripe_id: data.customer },
        });
        if (!user) {
          console.warn(
            `⚠️ subscription.created sin usuario para ${data.customer}`,
          );
          break;
        }

        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        await Subscription.findOrCreate({
          where: { stripe_subscription_id: data.id },
          defaults: {
            userId: user.id,
            stripe_subscription_id: data.id,
            stripe_customer_id: data.customer,
            status: data.status,
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
       * 3. PAGO FALLIDO (1er intento o reintentos)
       *    Stripe reintentará hasta 8 veces en ~1 semana.
       *    Durante ese tiempo → mantenemos acceso (past_due).
       *    NO quitamos isSubscribed aquí.
       *    Stripe cancelará solo si todos los intentos fallan
       *    y eso lo manejamos en customer.subscription.deleted
       * ══════════════════════════════════════════════════ */
      case "invoice.payment_failed": {
        const subscriptionId =
          data.subscription || data.parent?.subscription_details?.subscription;

        if (!subscriptionId) {
          console.warn(
            "⚠️ invoice.payment_failed sin subscriptionId, ignorando",
          );
          break;
        }

        // ✅ NUEVO: No pisar un status ya cancelado
        const subActual = await Subscription.findOne({
          where: { stripe_subscription_id: subscriptionId },
        });

        if (!subActual) break;

        if (subActual.status === "canceled") {
          console.log(
            `ℹ️ Suscripción ${subscriptionId} ya cancelada, ignorando invoice.payment_failed tardío`,
          );
          break;
        }

        await subActual.update({ status: "past_due" });

        console.log(
          `⚠️ Pago fallido para suscripción ${subscriptionId}. Stripe reintentará automáticamente.`,
        );
        break;
      }

      /* ══════════════════════════════════════════════════
       * 4. SUSCRIPCIÓN ACTUALIZADA
       *    Cubre: cancelación programada, reactivación,
       *    cambio de plan, cambio de status por Stripe.
       *
       *    MAPA DE ACCESO:
       *    active    → ✅ acceso
       *    trialing  → ✅ acceso
       *    past_due  → ✅ acceso (Stripe reintentando)
       *    canceled  → ❌ sin acceso
       *    unpaid    → ❌ sin acceso
       *    incomplete_expired → ❌ sin acceso
       * ══════════════════════════════════════════════════ */
      case "customer.subscription.updated": {
        // Buscar el usuario por stripe_customer_id
        const user = await User.findOne({
          where: { stripe_id: data.customer },
        });
        if (!user) {
          console.warn(
            `⚠️ No se encontró usuario para customer ${data.customer}`,
          );
          break;
        }

        const status = data.status;
        const stripePeriodEnd =
          data.current_period_end || data.items?.data[0]?.current_period_end;

        // UPSERT: si no existe el registro, crearlo. Si existe, actualizarlo.
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

        if (created) {
          console.log(
            `✅ Suscripción ${data.id} creada desde subscription.updated`,
          );
        } else {
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
        const statusSinAcceso = ["canceled", "unpaid", "incomplete_expired"];

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
       * 5. SUSCRIPCIÓN CANCELADA DEFINITIVAMENTE
       *    Llega cuando:
       *    - El usuario canceló y expiró el periodo pagado
       *    - Stripe agotó todos los reintentos de cobro
       *    → Aquí sí quitamos el acceso, sin excepción
       * ══════════════════════════════════════════════════ */
      case "customer.subscription.deleted": {
        const sub = await Subscription.findOne({
          where: { stripe_subscription_id: data.id },
        });

        if (sub) {
          await sub.update({
            status: "canceled",
            ended_at: new Date(),
            will_cancel_at: null,
            next_renewal: null, // ✅ AGREGADO
          });
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

  const { ticketIds, eventId, buyerEmail, buyerName } = session.metadata ?? {};

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
    try {
      await sendTicketEmail(
        tickets,
        evento,
        usuario ?? { email: buyerEmail, name: buyerName },
      );
    } catch (emailErr) {
      console.error("⚠️ Email falló, tickets ya vendidos:", emailErr);
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
