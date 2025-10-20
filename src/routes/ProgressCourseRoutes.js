// routes/progressRoutes.js
const express = require("express");
const router = express.Router();
const courseProgressController = require("../controllers/CourseProgressController");

router.get("/:userId/:courseId", courseProgressController.getProgress);
router.post("/:userId/:courseId", courseProgressController.updateProgress);

module.exports = router;
