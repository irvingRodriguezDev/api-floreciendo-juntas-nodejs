const express = require("express");
const router = express.Router();
const {
  CreateModule,
  UpdateModule,
  DeleteModule,
  GetModulesByCertification,
} = require("../controllers/CertificationModuleController");
const { authMiddleware } = require("../middlewares/authMiddleware");
router.post("/", authMiddleware, CreateModule);
router.get("/:certificationId", GetModulesByCertification);
router.put("/:id", UpdateModule);
router.delete("/:id", DeleteModule);

module.exports = router;
