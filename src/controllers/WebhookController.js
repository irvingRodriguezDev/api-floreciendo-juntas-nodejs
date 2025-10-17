// src/controllers/webhookController.js

const stripe = require("../config/stripe"); // Tu instancia de Stripe
// ASUMO que importas correctamente los modelos User y Subscription
const { Subscription, User } = require("../models");
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Función auxiliar para calcular la fecha de expiración
const getExpirationDate = (subscriptionType) => {
  const now = new Date();
  if (subscriptionType === "ONETIME") {
    now.setMonth(now.getMonth() + 12); // Acceso por 1 año
    return now;
  }
  return null;
};

const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // 1. Verificación de la firma del Webhook (Seguridad)
  try {
    // IMPORTANTE: req.body debe ser RAW (Buffer) para la verificación de Webhook
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`⚠️ Error en la verificación del Webhook: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;
  const eventType = event.type;
  let userToUpdate = null; // Variable para simplificar la lógica de User

  // 2. Manejo de Eventos
  try {
    switch (eventType) {
      // ====================================================================
      // A. PAGO INICIAL (O ÚNICO) CONFIRMADO
      // ====================================================================
      case "checkout.session.completed": {
        const session = data;

        if (session.payment_status !== "paid") {
          return res.json({ received: true });
        }

        const { userId, subscriptionType } = session.metadata;
        const subscriptionId = session.subscription || null;

        // 1. Encontrar y actualizar el registro de Subscription
        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_checkout_session_id: session.id },
        });

        if (!subscriptionRecord) {
          console.error(
            `Subscription record not found for session ${session.id}`
          );
          // NO devolver 404, devolver 200 para que Stripe no reintente
          return res.json({ received: true });
        }

        const updateData = { status: "active", start_date: new Date() };

        if (subscriptionType === "ONETIME") {
          updateData.end_date = getExpirationDate("ONETIME");
        }

        // Guardar la ID de suscripción de Stripe si existe (para recurrente)
        if (subscriptionId) {
          updateData.stripe_subscription_id = subscriptionId;
        }

        await subscriptionRecord.update(updateData);

        // 2. ACTUALIZAR EL ESTADO DEL USUARIO (CRÍTICO)
        userToUpdate = await User.findByPk(userId);

        if (userToUpdate) {
          await userToUpdate.update({
            isSubscribed: true, // ¡ACCESO CONCEDIDO!
            // Guardamos el ID de suscripción de Stripe para futuras referencias
            stripeSubscriptionId: subscriptionId,
            // Asegúrate de que stripe_id (customer ID) esté guardado en el usuario
          });
        }

        break;
      }

      // ====================================================================
      // B. ACTUALIZACIONES DE SUSCRIPCIÓN RECURRENTE (Cancelación, Renovación)
      // ====================================================================
      case "customer.subscription.deleted": {
        const subscription = data; // El objeto de la suscripción

        // 1. Buscar el usuario por la ID de suscripción de Stripe
        userToUpdate = await User.findOne({
          where: { stripeSubscriptionId: subscription.id },
        });

        if (userToUpdate) {
          await userToUpdate.update({
            isSubscribed: false, // ¡ACCESO REVOCADO!
          });
        }

        // 2. Opcional: Actualizar el registro de Subscription en tu DB
        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });
        if (subscriptionRecord) {
          await subscriptionRecord.update({
            status: subscription.status, // "canceled" o "unpaid"
            end_date: new Date(), // La fecha actual de cancelación
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = data;

        // Si el estatus cambia a 'active', podemos actualizar la fecha de renovación
        if (subscription.status === "active") {
          // Buscar y actualizar el registro en tu DB
          const subscriptionRecord = await Subscription.findOne({
            where: { stripe_subscription_id: subscription.id },
          });
          if (subscriptionRecord) {
            await subscriptionRecord.update({
              status: "active",
              next_renewal: new Date(subscription.current_period_end * 1000),
            });
          }
        }
        break;
      }

      default:
        console.log(`Evento no manejado: ${eventType}`);
    }

    // 3. Responder a Stripe (Siempre 200 para indicar éxito)
    res.json({ received: true });
  } catch (error) {
    console.error(`Error en el handler de Webhook para ${eventType}:`, error);
    // IMPORTANTE: Responder con 200 o 500 basado en si el error es de Stripe o interno.
    // Usaremos 500 para forzar a Stripe a reintentar la entrega del evento.
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { handleStripeWebhook };
