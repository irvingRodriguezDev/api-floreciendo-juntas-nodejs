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
const { authMiddleware } = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  authMiddleware,
  CreateCertification,
);
router.get("/active", GetActiveCertifications);
router.get("/download-certificate", authMiddleware, downloadCertificate);
router.get("/my-progress/:id", authMiddleware, GetMyCertificationDetail);
router.get(
  "/module/detail/:moduleId",
  authMiddleware,
  GetModuleCertificationById,
);
router.get("/:id", GetCertificationById);

module.exports = router;
