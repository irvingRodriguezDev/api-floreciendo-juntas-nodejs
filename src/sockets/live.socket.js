const { LiveComment } = require("../models");

// ✅ Cache en memoria para evitar queries repetidas por reconexiones
const commentsCache = new Map();
const CACHE_TTL = 30000; // 30 segundos

module.exports = (io, socket) => {
  socket.on("join-live", async (liveId) => {
    try {
      socket.join(`live_${liveId}`);

      // ✅ Usar cache si existe y no ha expirado
      const cached = commentsCache.get(liveId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return socket.emit("load_comments", cached.data);
      }

      const comments = await LiveComment.findAll({
        where: { live_id: liveId },
        attributes: [
          "id",
          "live_id",
          "user_id",
          "user_name",
          "message",
          "createdAt",
        ],
        order: [["createdAt", "DESC"]],
        limit: 35,
      });

      const ordered = comments.reverse();

      // ✅ Guardar en cache
      commentsCache.set(liveId, {
        data: ordered,
        timestamp: Date.now(),
      });

      socket.emit("load_comments", ordered);
    } catch (err) {
      console.error("❌ Error al cargar comentarios:", err);
      socket.emit("comments_error", {
        message: "No se pudieron cargar los comentarios",
      });
    }
  });

  socket.on("send_comment", async ({ liveId, message }) => {
    try {
      if (!message || !liveId) return;

      const comment = await LiveComment.create({
        live_id: liveId,
        user_id: socket.user.id,
        user_name: socket.user.name,
        message,
      });

      // ✅ Invalidar cache al llegar comentario nuevo
      commentsCache.delete(liveId);

      io.to(`live_${liveId}`).emit("new_comment", comment);
    } catch (err) {
      console.error("❌ Error comentario:", err);
    }
  });

  socket.on("delete_comment", async ({ liveId, message_id }) => {
    try {
      if (!liveId || !message_id) return;

      const isAdmin = socket.user.role === "admin";
      if (!isAdmin) return;

      const comment = await LiveComment.findOne({
        where: { id: message_id, live_id: liveId },
        attributes: ["id"],
      });

      if (!comment) return;

      await comment.destroy();

      // ✅ Invalidar cache al eliminar
      commentsCache.delete(liveId);

      io.to(`live_${liveId}`).emit("remove_comment", { id: comment.id });
    } catch (err) {
      console.error("❌ Error al eliminar comentario:", err);
    }
  });

  socket.on("leave-live", (liveId) => {
    socket.leave(`live_${liveId}`);
  });
};
