const express = require("express");
const router = express.Router();
const {
  CreateEvaluation,
  GetEvaluationBySubmission,
} = require("../controllers/ModuleEvaluationCertificationController");
const { authMiddleware } = require("../middlewares/authMiddleware");
router.post("/", authMiddleware, CreateEvaluation);
router.get("/:submissionId", GetEvaluationBySubmission);

module.exports = router;
