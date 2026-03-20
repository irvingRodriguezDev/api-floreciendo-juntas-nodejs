// liveSocket.js
// Gestiona los eventos de Socket.io para el módulo de lives:
//   - join-live / leave-live
//   - live_app_viewers  (usuarios conectados al chat, instantáneo, gratis)
//   - live_viewer_count (viewers reales de IVS, viene del livePoller cada 15s)
//   - Comentarios: load, send, delete

const { LiveComment } = require("../models");

// ─────────────────────────────────────────────
// Cache de comentarios en memoria
// Evita saturar la DB en reconexiones masivas
// ─────────────────────────────────────────────
const commentsCache = new Map(); // liveId → { data, timestamp }
const CACHE_TTL = 30000; // 30 segundos

/**
 * Emite el conteo de sockets conectados a la sala.
 * Este número representa "cuántos usuarios de la app están en el chat",
 * no el total de viewers del stream (eso lo maneja livePoller → live_viewer_count).
 *
 * @param {import("socket.io").Server} io
 * @param {string} roomName  — formato: "live_<liveId>"
 */
const emitAppViewers = (io, roomName) => {
  const clients = io.sockets.adapter.rooms.get(roomName);
  const count = clients ? clients.size : 0;
  const liveId = roomName.replace("live_", "");
  io.to(roomName).emit("live_app_viewers", { liveId, count });
};

// ─────────────────────────────────────────────
// Handler principal — se registra por cada socket conectado
// ─────────────────────────────────────────────
module.exports = (io, socket) => {
  // ── JOIN LIVE ──────────────────────────────
  socket.on("join-live", async (liveId) => {
    try {
      const roomName = `live_${liveId}`;
      socket.join(roomName);

      // Notificar a todos el nuevo conteo de usuarios en el chat
      emitAppViewers(io, roomName);

      // Cargar comentarios recientes (con cache)
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

      // Reordenar de más antiguo a más nuevo para mostrar en el chat
      const ordered = comments.reverse();

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

  // ── LEAVE LIVE (salida voluntaria) ─────────
  socket.on("leave-live", (liveId) => {
    const roomName = `live_${liveId}`;
    socket.leave(roomName);
    emitAppViewers(io, roomName);
  });

  // ── SEND COMMENT ───────────────────────────
  socket.on("send_comment", async ({ liveId, message }) => {
    try {
      if (!message || !liveId) return;

      // socket.user viene del middleware socketAuth.js
      const comment = await LiveComment.create({
        live_id: liveId,
        user_id: socket.user.id,
        user_name: socket.user.name,
        message,
      });

      // Invalidar cache para que el próximo que entre vea el comentario nuevo
      commentsCache.delete(liveId);

      io.to(`live_${liveId}`).emit("new_comment", comment);
    } catch (err) {
      console.error("❌ Error al enviar comentario:", err);
    }
  });

  // ── DELETE COMMENT (solo admins) ───────────
  socket.on("delete_comment", async ({ liveId, message_id }) => {
    try {
      if (!liveId || !message_id) return;

      const isAdmin = socket.user?.role === "admin";
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

  // ── DISCONNECTING (cierra tab o pierde red) ─
  // En este punto el socket TODAVÍA está en las salas,
  // por eso restamos 1 manualmente para que el conteo sea correcto.
  socket.on("disconnecting", () => {
    socket.rooms.forEach((room) => {
      if (!room.startsWith("live_")) return;

      const currentSize = io.sockets.adapter.rooms.get(room)?.size ?? 1;
      const liveId = room.replace("live_", "");

      io.to(room).emit("live_app_viewers", {
        liveId,
        count: Math.max(0, currentSize - 1),
      });
    });
  });
};

// ─────────────────────────────────────────────
// GUÍA DE EVENTOS — referencia para el cliente
// ─────────────────────────────────────────────
//
// Cliente EMITE:
//   socket.emit("join-live",      liveId)
//   socket.emit("leave-live",     liveId)
//   socket.emit("send_comment",   { liveId, message })
//   socket.emit("delete_comment", { liveId, message_id })   // solo admin
//
// Cliente ESCUCHA:
//   socket.on("live_app_viewers",   ({ liveId, count }))
//     → Usuarios conectados al chat en tiempo real (instantáneo)
//
//   socket.on("live_viewer_count",  ({ liveId, viewers, isLive, health, startedAt, updatedAt }))
//     → Viewers reales del stream en IVS (se actualiza cada ~15s desde el servidor)
//
//   socket.on("load_comments",  comments[])
//   socket.on("new_comment",    comment)
//   socket.on("remove_comment", { id })
//   socket.on("comments_error", { message })
//
//   socket.on("live_started",   { liveId, status, startedAt })
//   socket.on("live_ended",     { liveId, endedAt })
//   socket.on("live_error",     { liveId, failedAt })
