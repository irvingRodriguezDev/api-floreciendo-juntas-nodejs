// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const { isBlacklisted } = require("../utils/tokenBlacklist");

const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token)
    return res.status(401).json({ msg: "Acceso denegado. Token requerido" });

  if (isBlacklisted(token))
    return res.status(401).json({ msg: "Token inválido (logout realizado)" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ msg: "Token inválido o expirado" });
  }
};

module.exports = authMiddleware;
