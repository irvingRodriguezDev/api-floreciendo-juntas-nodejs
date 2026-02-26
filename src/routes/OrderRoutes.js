const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const OrderController = require("../controllers/OrderController");
const OrderPdfController = require("../controllers/OrderPdfController");
router.use(authMiddleware);
router.get("/", OrderController.getOrdersAdmin);
router.post("/create", OrderController.createOrderFromCart);
router.get("/user/:userId", OrderController.getUserOrders);
router.get(
  "/:orderId/account-statement",
  OrderPdfController.generateOrderAccountStatement,
);
router.post(
  "/assignShippingCost/:orderId",
  OrderController.assignamentShippingCost,
);
router.get("/active", OrderController.getOrdersActiveAdmin);
router.get("/completed", OrderController.getOrdersCompletedAdmin);
router.get("/shipp-payed", OrderController.getOrdersShippPayed);
router.get("/shipped", OrderController.getOrdersShipped);
router.put("/:id/shipping-info", OrderController.updateShippingInfo);
router.get("/detail/:order_id", OrderController.getOrderDetailAdmin);
router.get("/:orderId", OrderController.getOrderDetail);
module.exports = router;
