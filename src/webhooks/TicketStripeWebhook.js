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
  async (req, res) => {}
);

export default router;
