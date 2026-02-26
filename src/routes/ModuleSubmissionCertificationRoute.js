const express = require("express");
const router = express.Router();
const {
  CreateSubmission,
  GetMySubmissions,
  GetAllSubmissionSubmitted,
  GetAllSubmissionReviewed,
} = require("../controllers/ModuleSubmisionCertificationController");
const { upload } = require("../middlewares/uploadCourseImage");
const { authMiddleware } = require("../middlewares/authMiddleware");
router.post("/", upload.array("files", 3), authMiddleware, CreateSubmission);
router.get("/", authMiddleware, GetMySubmissions);
router.get("/submitted", authMiddleware, GetAllSubmissionSubmitted);
router.get("/reviewed", authMiddleware, GetAllSubmissionReviewed);

module.exports = router;
