const express = require("express");
const router = express.Router();
const {
  createFormation,
  GetActiveFormations,
  updateFormation,
  deleteFormation,
  getFormationModules,
  showFormation,
  showFormationProgress,
  submitModuleDelivery,
  getPendingDeliveries,
  reviewModuleDelivery,
  downloadDiploma,
} = require("../controllers/FormationsController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { handleUpload, upload } = require("../middlewares/uploadCourseImage");

router.post(
  "/",
  handleUpload(upload.single("diploma")),
  authMiddleware,
  createFormation,
);
router.post(
  "/submit-delivery/:moduleFormationId",
  handleUpload(upload.single("evidence")),
  authMiddleware,
  submitModuleDelivery,
);
router.get("/deliveries/pending", authMiddleware, getPendingDeliveries);
router.post("/review-delivery/:id", authMiddleware, reviewModuleDelivery);
router.get("/active", GetActiveFormations);
router.get("/formation-progress/:id", authMiddleware, showFormationProgress);
router.get("/download-diploma", authMiddleware, downloadDiploma);
router.get("/:id", authMiddleware, showFormation);
router.get("/:id/modules", getFormationModules);
router.put(
  "/:id",
  handleUpload(upload.single("diploma")),
  authMiddleware,
  updateFormation,
);
router.delete("/:id", authMiddleware, deleteFormation);

module.exports = router;
