const express = require("express");
const router = express.Router();

const authRoutes = require("./AuthRoutes");
const paymentRoutes = require("./PaymentRoutes");
const webhookRoutes = require("./WebhookRoutes");
const courseRoutes = require("./CourseRoutes");
const courseVideoRoutes = require("./CourseVideoRoutes");
const systemRoutes = require("./SystemRoutes");
router.use("/auth", authRoutes);
router.use("/payment", paymentRoutes);
router.use("/webhook", webhookRoutes);
router.use("/courses", courseRoutes);
router.use("/course-video", courseVideoRoutes);
router.use("/systems", systemRoutes);

module.exports = router;
