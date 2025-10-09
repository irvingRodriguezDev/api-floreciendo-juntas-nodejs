const express = require("express");
const router = express.Router();
const systemController = require("../controllers/SystemController");

// Rutas CRUD
router.get("/", systemController.getSystems);
router.post("/", systemController.createSystem);
router.put("/:id", systemController.updateSystem);
router.delete("/:id", systemController.deleteSystem);

module.exports = router;
