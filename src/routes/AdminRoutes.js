const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const router = express.Router();
const usrCtrl = require("../controllers/admin/UserController");
router.get("/users", authMiddleware, usrCtrl.getAllUsers);
module.exports = router;
