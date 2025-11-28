const express = require("express");
const router = express.Router();

const {
  getBoletos,
  getBoletosResumen,
  getBoletoById,
} = require("../controllers/admin/StripeController");

router.get("/boletos", getBoletos);
router.get("/boletos/resumen", getBoletosResumen);
router.get("/boletos/:id", getBoletoById);

module.exports = router;
