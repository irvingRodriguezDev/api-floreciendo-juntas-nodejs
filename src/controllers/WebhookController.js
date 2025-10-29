const stripe = require("../config/stripe");
const { Subscription, User, Ticket } = require("../models");
const generateTicketPDF = require("../helpers/generateTicketPdf");
const sendTicketEmail = require("../helpers/sendTicketMail");
const subscriptionEndpointSecret =
  process.env.STRIPE_WEBHOOK_SUBSCRIPTION_SECRET;
const ticketEndpointSecret = process.env.STRIPE_WEBHOOK_TICKET_SECRET;

// Función para calcular expiración de pago único
const getExpirationDate = () => {
  const now = new Date();
  now.setMonth(now.getMonth() + 12);
  return now;
};

const handleSubscriptionStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // req.body debe ser RAW (Buffer)
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      subscriptionEndpointSecret
    );
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

const handleTicketStripeWebhook = async (req, res) => {
  // El cuerpo de la solicitud (req.body) DEBE ser el buffer raw para la verificación.
  const sig = req.headers["stripe-signature"];

  try {
    // Construir el evento de Stripe y verificar la firma
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      ticketEndpointSecret
    );

    // Solo manejamos checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Obtener metadatos de la sesión
      const { ticketId, eventId, buyerName, buyerEmail } = session.metadata;

      const ticketIdNumber = parseInt(ticketId, 10);

      // Buscar ticket reservado
      const ticket = await Ticket.findByPk(ticketIdNumber);

      // Stripe reintentará este evento si no recibe un 2xx.
      if (!ticket) {
        console.warn(`Ticket #${ticketIdNumber} no encontrado. Se ignora.`);
        // Retornamos 200 OK para evitar que Stripe reintente un ticket inexistente
        return res.status(200).json({
          received: true,
          message: "Ticket ignorado (no encontrado).",
        });
      }

      // Marcar como vendido y liberar la reserva
      ticket.sold = true;
      ticket.reserved = false;
      ticket.reservation_expires_at = null;
      await ticket.save();

      // Emitir evento por socket (si lo tienes conectado)
      if (req.io) {
        req.io.emit("ticketSold", {
          eventId,
          ticketId: ticket.id,
          buyerName,
        });
      }

      // 1. Generar QR y subir a S3
      // La función 'generateTicketQR' ya retorna la URL pública (la corrección anterior)
      const publicUrl = await generateTicketPDF(ticket);

      // 2. Enviar correo con la URL
      // Usamos el 'buyerEmail' de la sesión de Stripe, que es la fuente de verdad del pago.
      await sendTicketEmail(buyerEmail, publicUrl, ticket);

      console.log(
        `🎟️ Ticket #${ticket.id} confirmado y enviado a ${buyerEmail}`
      );
    }

    // Respuesta exitosa (200 OK)
    res.status(200).json({ received: true });
  } catch (err) {
    // Si la firma es inválida o hay otro error, Stripe lo reintentará.
    console.error("❌ Error en webhook de ticket:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

module.exports = { handleSubscriptionStripeWebhook, handleTicketStripeWebhook };
