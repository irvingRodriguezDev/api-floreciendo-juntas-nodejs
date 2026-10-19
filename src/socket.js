let io = null;

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: {
        origin: "*", // O tu URL de desarrollo (ej. http://localhost:5173)
        methods: ["GET", "POST"],
        credentials: true, // 👈 CRUCIAL: Sin esto, el servidor rechaza las cookies del socket
      },
      path: "/socket.io",
    });
    return io;
  },
  getIO: () => {
    if (!io) throw new Error("Socket.io no está inicializado");
    return io;
  },
};
