const stripe = require("../config/stripe");
const { Subscription, User, Ticket, Event } = require("../models");
const sendTicketEmail = require("../helpers/sendTicketMail");

const subscriptionEndpointSecret =
  process.env.STRIPE_WEBHOOK_SUBSCRIPTION_SECRET;
const ticketEndpointSecret = process.env.STRIPE_WEBHOOK_TICKET_SECRET;

// 📅 Función para expiración de pago único (1 mes)
const getExpirationDate = () => {
  const now = new Date();
  now.setMonth(now.getMonth() + 1);
  return now;
};

/* -----------------------------
   📦 Webhook: SUSCRIPCIONES
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
    console.log("✅ Evento recibido (suscripción):", event.type);
  } catch (err) {
    console.error("❌ Error verificando webhook suscripción:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  try {
    // 🚫 Filtrar eventos que no correspondan a suscripciones
    if (
      event.type === "checkout.session.completed" &&
      data.mode !== "subscription"
    ) {
      console.log("⚠️ Evento ignorado (no es una suscripción):", data.mode);
      return res.status(200).json({ received: true });
    }

    switch (event.type) {
      // 🟢 Cuando se completa la compra de la suscripción
      case "checkout.session.completed": {
        const session = data;
        console.log("checkout.session.completed metadata:", session.metadata);

        if (!session.metadata || !session.metadata.userId) {
          console.warn("⚠️ Sesión sin metadata esperada. Se ignora.");
          return res.status(200).json({ received: true });
        }

        if (session.payment_status !== "paid") {
          console.log("⚠️ Pago no completado, ignorado.");
          return res.status(200).json({ received: true });
        }

        const { userId, subscriptionType } = session.metadata;
        const subscriptionId = session.subscription || null;

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_checkout_session_id: session.id },
        });

        if (!subscriptionRecord) {
          console.warn(
            "⚠️ No se encontró registro de suscripción:",
            session.id
          );
          return res.status(200).json({ received: true });
        }

        const updateData = {
          status: "active",
          start_date: new Date(),
        };

        // 🗓️ Si es una suscripción de pago único (1 mes)
        if (subscriptionType === "ONETIME") {
          updateData.end_date = getExpirationDate(); // función que calcula +30 días
        }

        // 🔁 Si es una suscripción recurrente
        if (subscriptionId) {
          updateData.stripe_subscription_id = subscriptionId;
        }

        await subscriptionRecord.update(updateData);
        console.log("✅ Suscripción actualizada:", subscriptionRecord.id);

        // 👤 Actualizar usuario
        const userToUpdate = await User.findByPk(userId);
        if (userToUpdate) {
          await userToUpdate.update({
            isSubscribed: true,
            stripeSubscriptionId: subscriptionId,
          });
          console.log("👤 Usuario actualizado:", userToUpdate.id);
        }

        break;
      }

      // 🔴 Cuando el usuario cancela la suscripción
      case "customer.subscription.deleted": {
        const subscription = data;
        const userToUpdate = await User.findOne({
          where: { stripeSubscriptionId: subscription.id },
        });

        if (userToUpdate) {
          await userToUpdate.update({ isSubscribed: false });
          console.log("👤 Usuario dado de baja:", userToUpdate.id);
        }

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });

        if (subscriptionRecord) {
          await subscriptionRecord.update({
            status: subscription.status,
            end_date: new Date(),
          });
          console.log("🟥 Suscripción cancelada:", subscription.id);
        }

        break;
      }

      // 🔁 Cuando Stripe actualiza el periodo o estado
      case "customer.subscription.updated": {
        const subscription = data;
        console.log("🔔 customer.subscription.updated:", {
          id: subscription.id,
          status: subscription.status,
          current_period_end: subscription.current_period_end,
        });

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });

        if (subscriptionRecord) {
          const updateData = { status: subscription.status };

          // 🧩 Validar que current_period_end sea válido
          if (subscription.current_period_end) {
            const timestamp = subscription.current_period_end * 1000;
            const date = new Date(timestamp);
            if (!isNaN(date)) {
              updateData.next_renewal = date;
            } else {
              console.warn(
                "⚠️ Fecha inválida recibida en current_period_end:",
                subscription.current_period_end
              );
            }
          } else {
            console.warn("⚠️ Sin current_period_end en este evento");
          }

          await subscriptionRecord.update(updateData);
          console.log("🔁 Suscripción actualizada:", subscription.id);
        }

        break;
      }

      default:
        console.log(`ℹ️ Evento no manejado (suscripción): ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("💥 Error manejando webhook (suscripción):", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/* -----------------------------
   🎟️ Webhook: TICKETS
----------------------------- */
const handleTicketStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      ticketEndpointSecret
    );

    // 🚫 Filtrar: si no es un pago único (payment), salir
    if (
      event.type === "checkout.session.completed" &&
      event.data.object.mode !== "payment"
    ) {
      console.log(
        "⚠️ Evento ignorado (no es un ticket):",
        event.data.object.mode
      );
      return res.status(200).json({ received: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (!session.metadata || !session.metadata.ticketId) {
        console.warn("⚠️ Sesión sin metadata de ticket:", session.id);
        return res.status(200).json({ received: true });
      }

      const { ticketId, eventId, buyerName, buyerEmail } = session.metadata;

      const ticket = await Ticket.findByPk(Number(ticketId));
      const evento = await Event.findByPk(Number(eventId));
      const usuario = buyerEmail
        ? await User.findOne({ where: { email: buyerEmail } })
        : null;

      if (!ticket) {
        console.warn(`⚠️ Ticket #${ticketId} no encontrado.`);
        return res.status(200).json({ received: true });
      }

      // Marcar como vendido
      ticket.sold = true;
      ticket.reserved = false;
      ticket.reservation_expires_at = null;
      await ticket.save();

      if (req.io) {
        req.io.emit("ticketSold", {
          eventId: Number(eventId),
          ticketId: ticket.id,
          buyerName,
        });
      }

      await sendTicketEmail(ticket, evento, usuario);
      console.log(
        `✅ Ticket #${ticket.id} confirmado y enviado a ${buyerEmail}`
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error en webhook de ticket:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

module.exports = {
  handleSubscriptionStripeWebhook,
  handleTicketStripeWebhook,
};
