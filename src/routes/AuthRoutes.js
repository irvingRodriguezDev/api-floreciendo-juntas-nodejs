const express = require("express");
const {
  register,
  login,
  profile,
  createUserWithRole,
  me,
  logout,
  resetPassword,
  uploadProfileImage,
  updateInfoUser,
  saveBirthDate,
  getTodayBirthdays,
} = require("../controllers/AuthController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/roleMiddleware");
const { handleUpload, upload } = require("../middlewares/uploadCourseImage");
const verifyCaptcha = require("../middlewares/verifyCaptcha");
const router = express.Router();

router.post("/register", verifyCaptcha, register); // usuario normal
router.post("/reset-password", verifyCaptcha, resetPassword); // usuario normal
router.post("/login", login);
router.post(
  "/uploadProfileImage",
  handleUpload(upload.single("file")),
  authMiddleware,
  uploadProfileImage,
);
router.post("/saveBirthDate", authMiddleware, saveBirthDate);
router.get("/profile", authMiddleware, profile);
router.get("/cumpleaneras", authMiddleware, getTodayBirthdays);
router.get("/me", authMiddleware, me);
router.put("/user/update", authMiddleware, updateInfoUser);
router.post("/logout", authMiddleware, logout);
// Solo admin puede crear otros usuarios especiales
router.post(
  "/create-user",
  upload.single("profileImage"),
  authMiddleware,
  checkRole([1]),
  createUserWithRole,
);

module.exports = router;
