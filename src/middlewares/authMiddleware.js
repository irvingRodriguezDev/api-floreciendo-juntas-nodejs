const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isBlacklisted } = require("../utils/tokenBlacklist");

/**
 * Middleware de Autenticación Optimizado
 * - Sin caché en memoria para ahorrar RAM.
 * - Consultas 'raw' para mínima carga de CPU.
 * - Validación de sesión única.
 */
const authMiddleware = async (req, res, next) => {
  try {
    // 1. Extracción y validación básica del token
    const authHeader = req.header("Authorization");

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : null;

    if (!token) {
      return res.status(401).json({ msg: "Acceso denegado. Token requerido" });
    }

    // 2. Verificación de Blacklist (Logout)
    if (isBlacklisted(token)) {
      return res.status(401).json({ msg: "Token inválido (sesión cerrada)" });
    }

    // 3. Verificación de integridad del JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ msg: "Token inválido o expirado" });
    }

    // 4. Consulta Quirúrgica a la base de datos
    // Usamos 'raw: true' para obtener un objeto JSON puro, ahorrando CPU y RAM
    const user = await User.findByPk(decoded.id, {
      attributes: [
        "id",
        "roleId",
        "session_id",
        "email",
        "name",
        "isSubscribed",
      ],
      raw: true,
    });

    if (!user) {
      return res.status(401).json({ msg: "Usuario no encontrado" });
    }

    // 5. Validación de sesión única (Solo para alumnos/roleId 4)
    if (user.roleId === 4) {
      // Si el sessionId del token no coincide con el de la DB, alguien más inició sesión
      if (!decoded.sessionId || user.session_id !== decoded.sessionId) {
        return res.status(401).json({
          msg: "Tu sesión ha expirado porque se inició sesión en otro dispositivo.",
          reason: "multiple_session",
        });
      }
    }

    // 6. Inyectar usuario en la petición y continuar
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error("❌ Error en authMiddleware:", error.message);
    return res.status(500).json({ msg: "Error interno de autenticación" });
  }
};

module.exports = { authMiddleware };
