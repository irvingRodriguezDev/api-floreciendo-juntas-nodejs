const jwt = require("jsonwebtoken");
const { User } = require("../models");

module.exports = async (socket, next) => {
  try {
    let token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("AuthError: Token requerido"));
    }

    // 👇 SOLO por seguridad futura
    if (token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id);

    if (!user) {
      return next(new Error("AuthError: Usuario no válido"));
    }

    // 🔑 disponible en todos los sockets
    socket.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roleId === 1 ? "admin" : "owner",
    };

    next();
  } catch (err) {
    console.error("❌ Socket auth error:", err.message);
    next(new Error("AuthError: Token inválido"));
  }
};
