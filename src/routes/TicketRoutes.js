// routes/ticketRoutes.js
const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/TicketController");

// Crear sesión Stripe
router.post("/buy-ticket", ticketController.createStripeSession);

// Webhook Stripe
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  ticketController.stripeWebhook
);

module.exports = router;
