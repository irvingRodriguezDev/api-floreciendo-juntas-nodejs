const express = require("express");
const router = express.Router();

const authRoutes = require("./AuthRoutes");
const paymentRoutes = require("./PaymentRoutes");
const webhookRoutes = require("./WebhookRoutes");
const courseRoutes = require("./CourseRoutes");
const courseVideoRoutes = require("./CourseVideoRoutes");
const systemRoutes = require("./SystemRoutes");
const videoRoutes = require("./VideosRoutes");
router.use("/auth", authRoutes);
router.use("/payment", paymentRoutes);
router.use("/webhook", webhookRoutes);
router.use("/courses", courseRoutes);
router.use("/course-video", courseVideoRoutes);
router.use("/systems", systemRoutes);
router.use("/videos", videoRoutes);

module.exports = router;
