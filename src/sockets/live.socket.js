const { LiveComment } = require("../models");

module.exports = (io, socket) => {
  socket.on("join-live", async (liveId) => {
    try {
      socket.join(`live_${liveId}`);

      // 🔎 Obtener últimos 15 comentarios
      const comments = await LiveComment.findAll({
        where: {
          live_id: liveId,
        },
        order: [["createdAt", "DESC"]],
        limit: 15,
      });

      // 🔁 Enviar en orden correcto (viejo → nuevo)
      socket.emit("load_comments", comments.reverse());
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
        user_name: socket.user.name, // 🔥 viene del token
        message,
      });

      io.to(`live_${liveId}`).emit("new_comment", comment);
    } catch (err) {
      console.error("❌ Error comentario:", err);
    }
  });
  socket.on("delete_comment", async ({ liveId, message_id }) => {
    try {
      console.log(message_id, liveId, "los datos linea 43");

      if (!liveId || !message_id) return;

      // 1️⃣ Buscar comentario
      const comment = await LiveComment.findOne({
        where: {
          id: message_id,
          live_id: liveId,
        },
      });

      if (!comment) return;

      // 2️⃣ Permisos
      const isAdmin = socket.user.role === "admin"; // si lo manejas

      if (!isAdmin) {
        return;
      }

      // 3️⃣ Eliminar (soft delete si paranoid)
      await comment.destroy();
      console.log("se elimina el comentario, linea 65");

      // 4️⃣ Notificar a todos
      io.to(`live_${liveId}`).emit("remove_comment", {
        id: comment.id,
      });
    } catch (err) {
      console.error("❌ Error al eliminar comentario:", err);
    }
  });
  socket.on("leave-live", (liveId) => {
    socket.leave(`live_${liveId}`);
  });
};
