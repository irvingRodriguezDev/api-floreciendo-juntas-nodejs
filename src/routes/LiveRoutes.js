const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const liveController = require("../controllers/LiveController");
const { upload } = require("../middlewares/uploadCourseImage");
router.post("/webhooks/ivs", liveController.handleIvsWebhook);
router.get("/", liveController.getAllLives);
router.get("/:id", liveController.getLiveById);
router.get("/:id/status", liveController.getStreamStatus);
router.post(
  "/",
  upload.single("file"),
  authMiddleware,
  liveController.createLive
);
router.put(
  "/:id",
  upload.single("file"),
  authMiddleware,
  liveController.updateLive
);
router.patch("/:id/status", liveController.updateStatus);
router.delete("/:id", liveController.deleteLive);

// Solo para admin/host
router.get("/:id/stream-config", liveController.getStreamConfig);
module.exports = router;
