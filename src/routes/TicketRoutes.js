// routes/ticketRoutes.js
const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/TicketController");
const { generateICSFile } = require("../helpers/generateCalendarLinks");
const { authMiddleware } = require("../middlewares/authMiddleware");
// Crear sesión Stripe
router.get("/byUser/:userId", ticketController.getUserTickets);
router.get("/:ticketId/calendar-links", ticketController.generateLinks);
router.get("/download", authMiddleware, ticketController.downloadTicket);
router.post("/validate", ticketController.validateTicket);

module.exports = router;
