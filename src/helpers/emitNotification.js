const { getIO } = require("../socket");

const emitNotification = (userId, notification) => {
  try {
    const io = getIO();
    if (!io) return console.error("❌ Socket.io no inicializado");

    // Forzamos String para que la sala 'user:1' sea siempre la misma
    const roomName = `user:${String(userId)}`;

    io.to(roomName).emit("notification:new", notification);
  } catch (error) {
    console.error("❌ emitNotification error:", error);
  }
};

module.exports = emitNotification;
