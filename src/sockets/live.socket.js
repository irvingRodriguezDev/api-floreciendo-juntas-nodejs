const { LiveComment } = require("../models");

// Cache en memoria para evitar saturar la DB en reconexiones masivas
const commentsCache = new Map();
const CACHE_TTL = 30000; // 30 segundos

module.exports = (io, socket) => {
  /**
   * FUNCIÓN AUXILIAR: Actualiza el conteo de espectadores para una sala específica.
   * Se comunica con la memoria de Socket.io (RAM), no con la Base de Datos.
   */
  const updateViewerCount = (roomName) => {
    const clients = io.sockets.adapter.rooms.get(roomName);
    const count = clients ? clients.size : 0;
    io.to(roomName).emit("live_viewer_count", count);
  };

  // --- EVENTO: UNIRSE AL LIVE ---
  socket.on("join-live", async (liveId) => {
    try {
      const roomName = `live_${liveId}`;
      socket.join(roomName);

      // 1. Notificar el nuevo conteo a todos en la sala
      updateViewerCount(roomName);

      // 2. Lógica de Comentarios con Cache
      const cached = commentsCache.get(liveId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return socket.emit("load_comments", cached.data);
      }

      const comments = await LiveComment.findAll({
        where: { live_id: liveId },
        attributes: ["id", "live_id", "user_name", "message", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit: 35,
      });

      const ordered = comments.reverse();

      // Guardar en cache para la siguiente persona que entre
      commentsCache.set(liveId, {
        data: ordered,
        timestamp: Date.now(),
      });

      socket.emit("load_comments", ordered);
    } catch (err) {
      console.error("❌ Error en join-live:", err);
      socket.emit("comments_error", { message: "Error al cargar el live" });
    }
  });

  // --- EVENTO: ENVIAR COMENTARIO ---
  socket.on("send_comment", async ({ liveId, message }) => {
    try {
      if (!message || !liveId) return;

      // socket.user viene de tu middleware socketAuth.js
      const comment = await LiveComment.create({
        live_id: liveId,
        user_id: socket.user.id,
        user_name: socket.user.name,
        message,
      });

      // Invalidar cache para que el próximo que entre vea el comentario nuevo
      commentsCache.delete(liveId);

      // Emitir el comentario a todos en la sala del live
      io.to(`live_${liveId}`).emit("new_comment", comment);
    } catch (err) {
      console.error("❌ Error al enviar comentario:", err);
    }
  });

  // --- EVENTO: ELIMINAR COMENTARIO (Solo Admins) ---
  socket.on("delete_comment", async ({ liveId, message_id }) => {
    try {
      if (!liveId || !message_id) return;

      // Verificación de rol (asumiendo que socketAuth define socket.user.role)
      const isAdmin = socket.user.role === "admin";
      if (!isAdmin) return;

      const comment = await LiveComment.findOne({
        where: { id: message_id, live_id: liveId },
        attributes: ["id"],
      });

      if (!comment) return;

      await comment.destroy();
      commentsCache.delete(liveId);

      io.to(`live_${liveId}`).emit("remove_comment", { id: comment.id });
    } catch (err) {
      console.error("❌ Error al eliminar comentario:", err);
    }
  });

  // --- EVENTO: SALIDA VOLUNTARIA ---
  socket.on("leave-live", (liveId) => {
    const roomName = `live_${liveId}`;
    socket.leave(roomName);
    updateViewerCount(roomName);
  });

  // --- EVENTO: DESCONEXIÓN (Cerrar pestaña o pérdida de red) ---
  socket.on("disconnecting", () => {
    // Revisamos todas las salas antes de que el socket se destruya
    socket.rooms.forEach((room) => {
      if (room.startsWith("live_")) {
        // IMPORTANTE: En este punto el socket todavía está en la sala,
        // por lo que el conteo bajará automáticamente un instante después.
        // Forzamos una actualización inmediata para los que se quedan:
        const currentSize = io.sockets.adapter.rooms.get(room)?.size || 1;
        io.to(room).emit("live_viewer_count", Math.max(0, currentSize - 1));
      }
    });
  });
};
