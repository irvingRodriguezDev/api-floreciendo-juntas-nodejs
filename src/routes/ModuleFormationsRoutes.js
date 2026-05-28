const express = require("express");
const {
  listModulesByFormation,
  createModule,
  updateModule,
  deleteModule,
} = require("../controllers/ModuleFormationsController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const router = express.Router();

// Listar todos los módulos
router.get("/modules/:formationId", listModulesByFormation);

// Crear nuevo módulo
router.post("/modules", authMiddleware, createModule);

// Actualizar módulo
router.put("/modules/:id", authMiddleware, updateModule);

// Eliminar módulo
router.delete("/modules/:id", authMiddleware, deleteModule);

module.exports = router;
