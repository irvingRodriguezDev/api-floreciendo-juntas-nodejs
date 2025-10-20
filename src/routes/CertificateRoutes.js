// routes/certificateRoutes.js
const express = require("express");
const router = express.Router();
const certificateController = require("../controllers/CertificateController");

router.get("/:userId/:courseId", certificateController.getCertificate);

module.exports = router;
