const express = require("express");
const router = express.Router();
const AddressController = require("../controllers/AddressController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Crear dirección
router.post("/", authMiddleware, AddressController.createAddress);

// Listar mis direcciones
router.get("/", authMiddleware, AddressController.getMyAddresses);

// Actualizar dirección
router.put("/:addressId", authMiddleware, AddressController.updateAddress);

// Eliminar dirección
router.delete("/:addressId", authMiddleware, AddressController.deleteAddress);

// Asignar dirección a una orden
router.post(
  "/assign/:orderId",
  authMiddleware,
  AddressController.assignAddressToOrder,
);

module.exports = router;
