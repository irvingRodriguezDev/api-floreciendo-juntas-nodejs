const express = require("express");
const {
  countCoursesCompletedByUser,
} = require("../controllers/UserController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();
router.get("/coursesCompleted", authMiddleware, countCoursesCompletedByUser);

module.exports = router;
