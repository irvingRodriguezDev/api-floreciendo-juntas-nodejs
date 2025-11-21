const express = require("express");
const router = express.Router();
const OrderPaymentController = require("../controllers/OrderPaymentsController");

router.post(
  "/create-checkout-session/:orderId",
  OrderPaymentController.createInitialPaymentSession
);
router.post(
  "/:orderId/pay-partial",
  OrderPaymentController.createCustomPaymentSession
);
module.exports = router;
