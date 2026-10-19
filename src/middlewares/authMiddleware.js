const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isBlacklisted } = require("../utils/tokenBlacklist");

const authMiddleware = async (req, res, next) => {
  try {
    // 1. Extraer el token directamente de la Cookie HttpOnly
    const token = req.cookies?.token;

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
    const user = await User.findByPk(decoded.id, {
      attributes: [
        "id",
        "roleId",
        "session_id",
        "email",
        "name",
        "isSubscribed",
        "profileImage",
      ],
      raw: true,
    });

    if (!user) {
      return res.status(401).json({ msg: "Usuario no encontrado" });
    }

    // 5. Validación de sesión única (Solo para alumnos/roleId 4)
    if (user.roleId === 4) {
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
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // Renueva las 24 horas de vida con cada visita activa
    });
    next();
  } catch (error) {
    console.error("❌ Error en authMiddleware:", error.message);
    return res.status(500).json({ msg: "Error interno de autenticación" });
  }
};

module.exports = { authMiddleware };
