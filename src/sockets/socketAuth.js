// backend/middleware/socketAuth.js
const jwt = require("jsonwebtoken");

module.exports = (socket, next) => {
  try {
    let token = socket.handshake.auth?.token;
    if (!token) return next(new Error("AuthError: Token requerido"));

    if (token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    }

    // 💡 Verifica el JWT. Si expira, el catch atrapará el error.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ⭐ OPTIMIZACIÓN: Usa los datos del token directamente.
    // NO uses User.findByPk(decoded.id) aquí.
    socket.user = {
      id: decoded.id,
      name: decoded.name,
      role: decoded.roleId === 1 ? "admin" : "owner",
    };
    if (decoded.id) {
      const room = `user:${String(decoded.id)}`;
      socket.join(room); // 👈 ESTO ES LO NECESARIO
    }

    next();
  } catch (err) {
    // Si el error es por expiración, enviamos un mensaje claro
    const message =
      err.name === "TokenExpiredError"
        ? "AuthError: Expired"
        : "AuthError: Invalid";

    // Solo logueamos errores que NO sean de expiración para limpiar los logs de Fargate
    if (err.name !== "TokenExpiredError") {
      console.error(`❌ Socket Auth: ${err.message}`);
    }

    next(new Error(message));
  }
};
