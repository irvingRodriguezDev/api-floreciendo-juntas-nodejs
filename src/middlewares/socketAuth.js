const jwt = require("jsonwebtoken");

module.exports = (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    if (!token) {
      socket.user = null;
      return next(); // permitimos lectura
    }

    const decoded = jwt.verify(
      token.replace("Bearer ", ""),
      process.env.JWT_SECRET
    );

    socket.user = {
      id: decoded.id,
      name: decoded.name,
      email: decoded.email,
    };

    next();
  } catch (error) {
    socket.user = null;
    next();
  }
};
