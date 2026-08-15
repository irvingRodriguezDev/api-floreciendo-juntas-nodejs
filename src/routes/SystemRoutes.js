const express = require("express");
const router = express.Router();
const { upload, handleUpload } = require("../middlewares/uploadCourseImage");
const systemController = require("../controllers/SystemController");

// Rutas CRUD
router.get("/", systemController.getSystems);
router.post(
  "/",
  handleUpload(upload.single("video")),
  systemController.createSystem,
);
router.get("/:id", systemController.showSystem);
router.put(
  "/:id",
  handleUpload(upload.single("video")),
  systemController.updateSystem,
);
router.delete("/:id", systemController.deleteSystem);

module.exports = router;
