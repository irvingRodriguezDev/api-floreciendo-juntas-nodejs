const express = require("express");
const router = express.Router();

const authRoutes = require("./AuthRoutes");
const paymentRoutes = require("./PaymentRoutes");
const webhookRoutes = require("./WebhookRoutes");

router.use("/auth", authRoutes);
router.use("/payment", paymentRoutes);
router.use("/webhook", webhookRoutes);

module.exports = router;
