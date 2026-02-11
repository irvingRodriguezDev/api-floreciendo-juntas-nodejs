// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isBlacklisted } = require("../utils/tokenBlacklist");

const authMiddleware = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ msg: "Acceso denegado. Token requerido" });
  }

  if (isBlacklisted(token)) {
    return res.status(401).json({ msg: "Token inválido (logout realizado)" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ msg: "Token inválido o expirado" });
  }

  // 🔍 Usuario
  const user = await User.findByPk(decoded.id);
  if (!user) {
    return res.status(401).json({ msg: "Usuario no válido" });
  }

  // 🔐 Sesión única SOLO para roleId === 4
  if (decoded.roleId === 4) {
    if (
      !decoded.sessionId ||
      !user.session_id ||
      user.session_id !== decoded.sessionId
    ) {
      return res.status(401).json({
        msg: "Sesión expirada",
        reason: "multiple_session",
      });
    }
  }

  // ✅ Todo OK
  req.user = user;
  req.token = token;

  next();
};

module.exports = authMiddleware;
