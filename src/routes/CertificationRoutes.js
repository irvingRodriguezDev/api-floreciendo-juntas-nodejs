const express = require("express");
const router = express.Router();
const {
  CreateCertification,
  GetActiveCertifications,
  GetCertificationById,
  GetMyCertificationDetail,
  GetModuleCertificationById,
  downloadCertificate,
} = require("../controllers/CertificationController");
const AuthMiddleware = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  AuthMiddleware,
  CreateCertification,
);
router.get("/active", GetActiveCertifications);
router.get("/download-certificate", AuthMiddleware, downloadCertificate);
router.get("/my-progress/:id", AuthMiddleware, GetMyCertificationDetail);
router.get(
  "/module/detail/:moduleId",
  AuthMiddleware,
  GetModuleCertificationById,
);
router.get("/:id", GetCertificationById);

module.exports = router;
