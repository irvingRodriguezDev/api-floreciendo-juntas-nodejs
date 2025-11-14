const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const OrderController = require("../controllers/OrderController");
const OrderPdfController = require("../controllers/OrderPdfController");
router.use(authMiddleware);
router.post("/create", OrderController.createOrderFromCart);
router.get("/user/:userId", OrderController.getUserOrders);
router.get(
  "/:orderId/account-statement",
  OrderPdfController.generateOrderAccountStatement
);
module.exports = router;
