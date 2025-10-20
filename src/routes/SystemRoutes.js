const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/uploadCourseImage");
const systemController = require("../controllers/SystemController");

// Rutas CRUD
router.get("/", systemController.getSystems);
router.post("/", upload.single("icon"), systemController.createSystem);
router.get("/:id", systemController.showSystem);
router.put("/:id", upload.single("icon"), systemController.updateSystem);
router.delete("/:id", systemController.deleteSystem);

module.exports = router;
