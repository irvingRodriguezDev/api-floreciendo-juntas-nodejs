// routes/videos.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const videoController = require("../controllers/VideoController");

const upload = multer({ storage: multer.memoryStorage() });

// Para presigned URL (frontend hace PUT directo a S3)
router.post("/presigned-url", videoController.generatePresignedUrl);

// Para subir desde backend (solo prueba o casos especiales)
router.post(
  "/upload-large",
  upload.single("file"),
  videoController.uploadLargeVideo
);

router.put("/update", videoController.updateVideo);

module.exports = router;
