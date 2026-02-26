const express = require("express");
const router = express.Router();
const {
  CreateCriterion,
  GetCriteriaByModule,
  UpdateCriterion,
  DeleteCriterion,
} = require("../controllers/ModuleCriterionCertificationController");
const { authMiddleware } = require("../middlewares/authMiddleware");
router.post("/", authMiddleware, CreateCriterion);
router.get("/:moduleId", GetCriteriaByModule);
router.put("/:id", UpdateCriterion);
router.delete("/:id", DeleteCriterion);

module.exports = router;
