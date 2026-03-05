// routes/billing.js

const express = require("express");
const router = express.Router();
const { createPortalSession } = require("../controllers/BillingController");
const { authMiddleware } = require("../middlewares/authMiddleware");

router.post("/portal", authMiddleware, createPortalSession);

module.exports = router;
