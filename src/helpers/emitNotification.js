const { getIO } = require("../socket");

/**
 * Emitir notificación en tiempo real a un usuario específico
 * @param {number} userId - ID del usuario destino
 * @param {object} notification - Objeto de notificación (DB shape)
 */
const emitNotification = (userId, notification) => {
  try {
    const io = getIO();

    io.to(`user:${userId}`).emit("notification:new", notification);
  } catch (error) {
    console.error("❌ emitNotification error:", error);
  }
};

module.exports = emitNotification;
