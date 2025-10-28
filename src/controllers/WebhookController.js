const stripe = require("../config/stripe");
const { Subscription, User } = require("../models");

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Función para calcular expiración de pago único
const getExpirationDate = () => {
  const now = new Date();
  now.setMonth(now.getMonth() + 12);
  return now;
};

const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // req.body debe ser RAW (Buffer)
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("Evento recibido:", event.type);
  } catch (err) {
    console.error("Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = data;
        console.log("checkout.session.completed metadata:", session.metadata);

        if (session.payment_status !== "paid") {
          console.log("Pago no completado");
          return res.json({ received: true });
        }

        const { userId, subscriptionType } = session.metadata;
        const subscriptionId = session.subscription || null;

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_checkout_session_id: session.id },
        });

        if (!subscriptionRecord) {
          console.warn("No se encontró la subscription en DB:", session.id);
          return res.json({ received: true });
        }

        const updateData = { status: "active", start_date: new Date() };
        if (subscriptionType === "ONETIME") {
          updateData.end_date = getExpirationDate();
        }
        if (subscriptionId) updateData.stripe_subscription_id = subscriptionId;

        await subscriptionRecord.update(updateData);
        console.log("Subscription actualizada:", subscriptionRecord.id);

        // Actualizar usuario
        const userToUpdate = await User.findByPk(userId);
        if (userToUpdate) {
          await userToUpdate.update({
            isSubscribed: true,
            stripeSubscriptionId: subscriptionId,
          });
          console.log("Usuario actualizado:", userToUpdate.id);
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = data;

        const userToUpdate = await User.findOne({
          where: { stripeSubscriptionId: subscription.id },
        });
        if (userToUpdate) {
          await userToUpdate.update({ isSubscribed: false });
        }

        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });
        if (subscriptionRecord) {
          await subscriptionRecord.update({
            status: subscription.status,
            end_date: new Date(),
          });
        }

        console.log("Suscripción cancelada:", subscription.id);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = data;
        if (subscription.status === "active") {
          const subscriptionRecord = await Subscription.findOne({
            where: { stripe_subscription_id: subscription.id },
          });
          if (subscriptionRecord) {
            await subscriptionRecord.update({
              status: "active",
              next_renewal: new Date(subscription.current_period_end * 1000),
            });
          }
          console.log("Suscripción recurrente actualizada:", subscription.id);
        }
        break;
      }

      default:
        console.log(`Evento no manejado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error manejando webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { handleStripeWebhook };
