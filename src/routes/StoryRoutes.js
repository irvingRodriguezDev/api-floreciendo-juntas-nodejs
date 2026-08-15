const express = require("express");
const router = express.Router();
const {
  createStory,
  getFeedStories,
  viewStory,
  deleteStory,
} = require("../controllers/StoryController");
const { authMiddleware } = require("../middlewares/authMiddleware"); // Middleware de autenticación
const { upload } = require("../middlewares/uploadCourseImage"); // Tu middleware de Multer-S3

// Subida de imagen y creación de historia
router.post("/", upload.single("file"), authMiddleware, createStory);

router.get("/feed", authMiddleware, getFeedStories);
router.post("/:storyId/view", authMiddleware, viewStory);
router.delete("/:storyId", authMiddleware, deleteStory);

module.exports = router;
