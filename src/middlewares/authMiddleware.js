const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isBlacklisted } = require("../utils/tokenBlacklist");

// ✅ Cache simple en memoria
const userCache = new Map();
const CACHE_TTL = 60000; // 60 segundos

const getCachedUser = async (userId) => {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.user;
  }

  const user = await User.findByPk(userId, {
    attributes: [
      "id",
      "email",
      "name",
      "roleId",
      "session_id",
      "profileImage",
      "isSubscribed",
      "phone",
      "username",
    ],
  });

  if (user) {
    userCache.set(userId, { user, timestamp: Date.now() });
  }

  return user;
};

// ✅ Llamar esto cuando el usuario haga logout o cambie de sesión
const invalidateUserCache = (userId) => {
  userCache.delete(userId);
};

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

  // ✅ Usuario desde cache — evita query a BD en cada request
  const user = await getCachedUser(decoded.id);
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

  req.user = user;
  req.token = token;
  next();
};

module.exports = { authMiddleware, invalidateUserCache };
