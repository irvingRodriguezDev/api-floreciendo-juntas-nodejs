// routes/stripeWebhookTicket.js
import express from "express";
import Stripe from "stripe";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚠️ Importante: body debe ser RAW, no JSON
router.post(
  "/webhook-ticket",
  express.raw({ type: "application/json" }),
  async (req, res) => {}
);

export default router;
