// socket.js
let io = null;

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: { origin: "*" },
      path: "/api/socket.io",
    });
    return io;
  },
  getIO: () => {
    if (!io) throw new Error("Socket.io no está inicializado");
    return io;
  },
};
