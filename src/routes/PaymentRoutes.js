const express = require("express");
const {
  crearSesionSuscripcionMensual,
  cancelSubscription,
  reactivateSubscription,
} = require("../controllers/PaymentController");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post(
  "/create-payment-recurring",
  authMiddleware,
  crearSesionSuscripcionMensual,
);
router.post("/reactivate", authMiddleware, reactivateSubscription);
router.post("/cancel", authMiddleware, cancelSubscription);

module.exports = router;
