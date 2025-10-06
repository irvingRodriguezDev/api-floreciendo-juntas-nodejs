const express = require("express");
const router = express.Router();
const { uploadVideo } = require("../controllers/courseVideoController");
const upload = require("../middlewares/uploadVideo");

router.post("/upload", upload.single("video"), uploadVideo);

module.exports = router;
