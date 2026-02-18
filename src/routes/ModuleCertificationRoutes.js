const express = require("express");
const router = express.Router();
const {
  CreateModule,
  UpdateModule,
  DeleteModule,
  GetModulesByCertification,
} = require("../controllers/CertificationModuleController");
const AuthMiddleware = require("../middlewares/authMiddleware");
router.post("/", AuthMiddleware, CreateModule);
router.get("/:certificationId", GetModulesByCertification);
router.put("/:id", UpdateModule);
router.delete("/:id", DeleteModule);

module.exports = router;
