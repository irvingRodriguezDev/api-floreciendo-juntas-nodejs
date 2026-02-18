const express = require("express");
const router = express.Router();
const {
  CreateEvaluation,
  GetEvaluationBySubmission,
} = require("../controllers/ModuleEvaluationCertificationController");
const AuthMiddleware = require("../middlewares/authMiddleware");
router.post("/", AuthMiddleware, CreateEvaluation);
router.get("/:submissionId", GetEvaluationBySubmission);

module.exports = router;
