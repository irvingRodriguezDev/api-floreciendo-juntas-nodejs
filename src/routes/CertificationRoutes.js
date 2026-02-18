const express = require("express");
const router = express.Router();
const {
  CreateCertification,
  GetActiveCertifications,
  GetCertificationById,
  GetMyCertificationDetail,
  GetModuleCertificationById,
} = require("../controllers/CertificationController");
const AuthMiddleware = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
router.post("/", upload.single("image"), AuthMiddleware, CreateCertification);
router.get("/active", GetActiveCertifications);
router.get("/my-progress/:id", AuthMiddleware, GetMyCertificationDetail);
router.get(
  "/module/detail/:moduleId",
  AuthMiddleware,
  GetModuleCertificationById,
);
router.get("/:id", GetCertificationById);

module.exports = router;
