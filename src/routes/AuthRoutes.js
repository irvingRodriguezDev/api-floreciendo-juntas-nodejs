const express = require("express");
const {
  register,
  login,
  profile,
  createUserWithRole,
  me,
} = require("../controllers/Auth/AuthController");
const authMiddleware = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/roleMiddleware");

const router = express.Router();

router.post("/register", register); // usuario normal
router.post("/login", login);
router.get("/profile", authMiddleware, profile);
router.get("/me", authMiddleware, me);

// Solo admin puede crear otros usuarios especiales
router.post("/create-user", authMiddleware, checkRole([1]), createUserWithRole);

module.exports = router;
