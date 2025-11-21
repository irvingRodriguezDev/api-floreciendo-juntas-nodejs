const express = require("express");
const {
  createPayment,
  crearSesionPagoUnico,
  crearSesionSuscripcionMensual,
} = require("../controllers/PaymentController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/create-payment", authMiddleware, createPayment);
router.post("/create-payment-onetime", authMiddleware, crearSesionPagoUnico);
router.post(
  "/create-payment-recurring",
  authMiddleware,
  crearSesionSuscripcionMensual
);

module.exports = router;
