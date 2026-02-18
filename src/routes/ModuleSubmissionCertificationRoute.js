const express = require("express");
const router = express.Router();
const {
  CreateSubmission,
  GetMySubmissions,
} = require("../controllers/ModuleSubmisionCertificationController");
const AuthMiddleware = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
const authMiddleware = require("../middlewares/authMiddleware");
router.post("/", upload.array("files", 3), AuthMiddleware, CreateSubmission);
router.get("/", authMiddleware, GetMySubmissions);

module.exports = router;
