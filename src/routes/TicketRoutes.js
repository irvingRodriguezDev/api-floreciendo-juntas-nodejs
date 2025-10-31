// routes/ticketRoutes.js
const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/TicketController");

// Crear sesión Stripe
router.post("/buy-ticket", ticketController.createStripeSession);
router.get("/byUser/:userId", ticketController.getUserTickets);
router.get("/download", ticketController.downloadTicket);
router.post("/validate", ticketController.validateTicket);

// Webhook Stripe
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  ticketController.stripeWebhook
);

module.exports = router;
