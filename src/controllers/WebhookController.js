// src/controllers/webhookController.js

const stripe = require("../config/stripe"); // Tu instancia de Stripe
const { Subscription, User } = require("../models"); // Tus modelos
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Tu secreto de Webhook (CRÍTICO)

// Función auxiliar para calcular la fecha de expiración
const getExpirationDate = (subscriptionType) => {
  const now = new Date();
  // Ejemplo: Pago único otorga acceso por 1 año (12 meses)
  if (subscriptionType === "ONETIME") {
    now.setMonth(now.getMonth() + 12);
    return now;
  }
  // Para RECURRING, la expiración se maneja con el campo next_renewal de Stripe
  return null;
};

const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // 1. Verificación de la firma del Webhook (Seguridad)
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`⚠️ Error en la verificación del Webhook: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Desestructurar los datos del evento
  const data = event.data.object;
  const eventType = event.type;

  // 2. Manejo de Eventos
  try {
    switch (eventType) {
      // ====================================================================
      // A. PAGO INICIAL (O ÚNICO) CONFIRMADO
      // Se usa para confirmar tanto suscripciones recurrentes como pagos únicos.
      // ====================================================================
      case "checkout.session.completed": {
        const session = data;

        // Si la sesión no fue pagada, salimos
        if (session.payment_status !== "paid") {
          return res.json({ received: true });
        }

        // Obtener datos que guardamos en metadata (el userId es CRÍTICO)
        const { userId, subscriptionType } = session.metadata;

        // 1. Encontrar el registro de Subscription creado como 'pending'
        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_checkout_session_id: session.id },
        });

        if (!subscriptionRecord) {
          console.error(
            `Subscription record not found for session ${session.id}`
          );
          return res
            .status(404)
            .json({ error: "Subscription record not found" });
        }

        // Lógica de Actualización
        const updateData = {
          status: "active",
          start_date: new Date(),
          // Si es recurrente, el ID de suscripción de Stripe es necesario
          stripe_subscription_id: session.subscription || null,
        };

        if (subscriptionType === "ONETIME") {
          // Para pagos únicos, calculamos la fecha de expiración
          updateData.end_date = getExpirationDate("ONETIME");
        }

        if (subscriptionType === "RECURRING" && session.subscription) {
          // Si es recurrente, usamos la API de Stripe para obtener la fecha de renovación
          const stripeSubscription = await stripe.subscriptions.retrieve(
            session.subscription
          );
          updateData.next_renewal = new Date(
            stripeSubscription.current_period_end * 1000
          );
        }

        // 2. Actualizar el registro en la DB
        await subscriptionRecord.update(updateData);

        break;
      }

      // ====================================================================
      // B. ACTUALIZACIONES DE SUSCRIPCIÓN RECURRENTE (Cancelación, Renovación)
      // Solo para el mode: 'subscription'
      // ====================================================================
      case "customer.subscription.deleted":
      case "customer.subscription.updated": {
        const subscription = data;

        // Buscar el registro por el ID de la suscripción de Stripe
        const subscriptionRecord = await Subscription.findOne({
          where: { stripe_subscription_id: subscription.id },
        });

        if (subscriptionRecord) {
          // Actualizar el estado y fechas según el evento
          await subscriptionRecord.update({
            status: subscription.status,
            end_date: subscription.canceled_at
              ? new Date(subscription.canceled_at * 1000)
              : null,
            next_renewal: new Date(subscription.current_period_end * 1000),
          });
        }
        break;
      }

      // Agrega más casos si es necesario (ej: invoice.payment_failed)

      default:
        // Manejar otros eventos no relevantes
        console.log(`Evento no manejado: ${eventType}`);
    }

    // 3. Responder a Stripe
    res.json({ received: true });
  } catch (error) {
    console.error(`Error en el handler de Webhook para ${eventType}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { handleStripeWebhook };
