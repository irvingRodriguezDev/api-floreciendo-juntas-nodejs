const jwt = require("jsonwebtoken");

module.exports = (socket, next) => {
  try {
    let token =
      socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    // 1. Si no hay token, decidimos si dejar pasar o no
    if (!token) {
      socket.user = null;
      return next(); // Permitir conexión como invitado
    }

    if (token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    }

    // 2. Verificación matemática (NO toca la base de datos 🔥)
    // Esto evita que un token inválido sature tu RDS
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Asignar datos del payload directamente
    // Asegúrate que al firmar el JWT incluyas estos campos
    socket.user = {
      id: decoded.id,
      name: decoded.name,
      role: decoded.roleId === 1 ? "admin" : "owner",
    };

    next();
  } catch (error) {
    // 4. Manejo inteligente de errores
    socket.user = null;

    if (error.name === "TokenExpiredError") {
      // Enviamos un error específico que el Frontend puede capturar
      // para dejar de reintentar (lo que corregimos en el otro archivo)
      return next(new Error("AuthError: Token expirado"));
    }

    if (error.name === "JsonWebTokenError") {
      return next(new Error("AuthError: Token malformado o inválido"));
    }

    // Para cualquier otro error, permitimos entrada como invitado
    // pero marcamos el error en el log de forma discreta
    next();
  }
};
