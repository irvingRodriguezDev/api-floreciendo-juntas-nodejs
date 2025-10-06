const express = require("express");
const { createPayment } = require("../controllers/PaymentController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/create-payment", authMiddleware, createPayment);

module.exports = router;
