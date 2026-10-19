// backend/middleware/socketAuth.js
const jwt = require("jsonwebtoken");
const cookie = require("cookie"); // 👈 Usamos la librería 'cookie'
// ❌ Ya no necesitamos require("cookie-parser") aquí

module.exports = (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      return next(
        new Error("Autenticación fallida: No se encontraron cookies"),
      );
    }

    // ✅ CORRECCIÓN: Usamos cookie.parse() en lugar de cookieParser()
    const cookies = cookie.parseCookie(cookieHeader);
    let token = cookies.token;

    if (!token) return next(new Error("AuthError: Token requerido"));

    if (token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    }

    // 💡 Verifica el JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.user = {
      id: decoded.id,
      name: decoded.name,
      role: decoded.roleId === 1 ? "admin" : "owner",
    };

    if (decoded.id) {
      const room = `user:${String(decoded.id)}`;
      socket.join(room);
    }

    next();
  } catch (err) {
    const message =
      err.name === "TokenExpiredError"
        ? "AuthError: Expired"
        : "AuthError: Invalid";

    if (err.name !== "TokenExpiredError") {
      console.error(`❌ Socket Auth: ${err.message}`);
    }

    next(new Error(message));
  }
};
