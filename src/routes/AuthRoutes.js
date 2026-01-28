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
} = require("../controllers/AuthController");
const authMiddleware = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/roleMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");

const router = express.Router();

router.post("/register", register); // usuario normal
router.post("/reset-password", resetPassword); // usuario normal
router.post("/login", login);
router.post(
  "/uploadProfileImage",
  upload.single("file"),
  authMiddleware,
  uploadProfileImage,
);
router.get("/profile", authMiddleware, profile);
router.get("/me", authMiddleware, me);
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
