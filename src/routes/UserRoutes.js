const express = require("express");
const {
  countCoursesCompletedByUser,
  getCompletedCoursesWithImages,
} = require("../controllers/UserController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();
router.get("/coursesCompleted", authMiddleware, countCoursesCompletedByUser);
router.get("/completedByUser", authMiddleware, getCompletedCoursesWithImages);
module.exports = router;
