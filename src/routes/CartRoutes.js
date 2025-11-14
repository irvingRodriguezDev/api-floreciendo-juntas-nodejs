const express = require("express");
const router = express.Router();
const CartController = require("../controllers/CartController");
const AuthMiddleware = require("../middlewares/authMiddleware");
router.use(AuthMiddleware);
router.post("/add", CartController.addItemToCart);
router.post("/sync", CartController.syncCart);
router.get("/", CartController.getUserCart);
router.put("/update/:itemId", CartController.updateCartItem);
router.delete("/remove/:itemId", CartController.removeCartItem);
router.delete("/clear", CartController.clearCart);

module.exports = router;
