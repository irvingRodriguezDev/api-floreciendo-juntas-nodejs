// routes/stripeWebhookTicket.js
import express from "express";
import Stripe from "stripe";
import Ticket from "../models/Ticket.js";
import { generateTicketPDF } from "../utils/pdfGenerator.js";
import { sendTicketEmail } from "../utils/sendEmail.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚠️ Importante: body debe ser RAW, no JSON
router.post(
  "/webhook-ticket",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_TICKET_SECRET // Clave distinta al webhook de suscripciones
      );

      // Solo manejamos los pagos de boletos
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const { eventId, userId } = session.metadata;

        // Crear el ticket en la base de datos
        const ticket = await Ticket.create({
          event_id: eventId,
          user_id: userId,
          payment_id: session.payment_intent,
        });

        // Generar PDF con QR
        const pdfPath = await generateTicketPDF(ticket);

        // Enviar el boleto al correo (opcional pero recomendable)
        await sendTicketEmail(userId, pdfPath);

        console.log("🎟️ Ticket generado y enviado al usuario.");
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("❌ Error en webhook de ticket:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

export default router;
