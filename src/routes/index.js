const express = require("express");
const router = express.Router();

const authRoutes = require("./AuthRoutes");
const paymentRoutes = require("./PaymentRoutes");
const webhookRoutes = require("./WebhookRoutes");
const courseRoutes = require("./CourseRoutes");
const courseVideoRoutes = require("./CourseVideoRoutes");
const systemRoutes = require("./SystemRoutes");
const videoRoutes = require("./VideosRoutes");
const CertificateRoutes = require("./CertificateRoutes");
const ProgressCourseRoutes = require("./ProgressCourseRoutes");
const CommunityRoutes = require("./CommunityRoutes");
const UserRoutes = require("./UserRoutes");
const adminRoutes = require("./AdminRoutes");
router.use("/auth", authRoutes);
router.use("/payment", paymentRoutes);
router.use("/webhook", webhookRoutes);
router.use("/courses", courseRoutes);
router.use("/course-video", courseVideoRoutes);
router.use("/systems", systemRoutes);
router.use("/videos", videoRoutes);
router.use("/certificate", CertificateRoutes);
router.use("/progress-video", ProgressCourseRoutes);
router.use("/community", CommunityRoutes);
router.use("/user", UserRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
