// controllers/liveController.js
const {
  getIvsChannelConfig,
  createIvsChannel,
  deleteIvsChannel,
  checkStreamIsLive,
  getStreamViewers,
} = require("../services/awsIvsService");
const {
  cancelDisconnect,
  scheduleDisconnect,
} = require("../helpers/streamDisconnectManager");
const { Op } = require("sequelize");
const emitNotification = require("../helpers/emitNotification");
const {
  Live,
  User,
  Notifications,
  NotificationToken,
  LiveComment,
} = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const moment = require("moment-timezone");
const { getIO } = require("../socket");
const {
  sendPushNotificationMulticast,
} = require("../services/sendPushNotification");
const { startPoller, stopPoller } = require("../services/livePoller");
const nowCdmx = () => {
  return moment().tz("America/Mexico_City");
};
// ========================
// Crear un Live con canal IVS dedicado
// ========================
const createLive = async (req, res) => {
  try {
    const { title, description, start_time, end_time, thumbnail_url } =
      req.body;

    // OPCIÓN A: Crear un canal IVS único por cada live
    const ivsChannel = await getIvsChannelConfig();
    const live = await Live.create({
      title,
      description,
      start_time,
      end_time,
      thumbnail_url,
      status: "scheduled",
      aws_channel_arn: ivsChannel.channelArn,
      aws_playback_url: ivsChannel.playbackUrl,
      aws_stream_key: ivsChannel.streamKey,
      aws_ingest_endpoint: ivsChannel.ingestEndpoint, // Importante para OBS
    });
    if (req.file) {
      const s3Key = await uploadToS3("lives", req.file, live.id);

      // Guardar key en BD
      live.thumbnail_url = s3Key;
      await live.save();
    }

    return res.status(201).json({
      message: "Live creado correctamente",
      live: {
        ...live.toJSON(),
        thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
      },
      // Retornar stream key solo al crear (para configurar OBS)
      streamConfig: {
        ingestEndpoint: ivsChannel.ingestEndpoint,
        streamKey: ivsChannel.streamKey,
      },
    });
  } catch (error) {
    console.error("Error al crear live:", error);
    return res.status(500).json({
      message: "Error al crear live",
      error: error.message,
    });
  }
};

// ========================
// Obtener todos los Lives
// ========================
const getAllLives = async (req, res) => {
  try {
    const now = nowCdmx();
    const toleranceMinutes = 15;

    /**
     * 1️⃣ Cancelar y soft-delete lives vencidos
     * Regla:
     * now > start_time + 15 min
     */
    const expiredLives = await Live.findAll({
      where: {
        status: "scheduled",
        start_time: {
          [Op.lt]: new Date(now - toleranceMinutes * 60 * 1000),
        },
      },
    });

    for (const live of expiredLives) {
      live.status = "cancelled";
      await live.save();
      await live.destroy(); // soft delete (deletedAt)
    }

    /**
     * 2️⃣ Obtener SOLO lives visibles
     */
    const lives = await Live.findAll({
      where: {
        status: {
          [Op.in]: ["scheduled", "live"],
        },
      },
      order: [["start_time", "ASC"]],
    });

    /**
     * 3️⃣ Mapear URLs públicas
     */
    const withPublicUrls = lives.map((live) => ({
      ...live.toJSON(),
      thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
      aws_stream_key: undefined,
    }));

    res.json(withPublicUrls);
  } catch (error) {
    console.error("Error al obtener lives:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ========================
// Obtener un Live por ID
// ========================
const getLiveById = async (req, res) => {
  try {
    const live = await Live.findByPk(req.params.id);

    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    res.json({
      ...live.toJSON(),
      thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
      // No exponer stream_key en GET público
      aws_stream_key: undefined,
    });
  } catch (error) {
    console.error("Error al obtener live:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ========================
// NUEVO: Verificar estado del stream en tiempo real
// ========================
const getStreamStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const live = await Live.findByPk(id);

    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    // Verificar en AWS si el stream está activo
    const streamStatus = await checkStreamIsLive(live.aws_channel_arn);

    // Actualizar estado automáticamente si está en vivo
    if (streamStatus.isLive && live.status === "scheduled") {
      live.status = "live";
      await live.save();
    } else if (!streamStatus.isLive && live.status === "live") {
      live.status = "ended";
      await live.save();
    }

    res.json({
      liveId: live.id,
      isLive: streamStatus.isLive,
      status: live.status,
      playbackUrl: live.aws_playback_url,
      streamInfo: streamStatus.streamInfo,
      thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
    });
  } catch (error) {
    console.error("Error al verificar estado del stream:", error);
    res.status(500).json({
      message: "Error al verificar estado",
      error: error.message,
    });
  }
};

// ========================
// NUEVO: Obtener configuración de streaming (solo para admin/host)
// ========================
const getStreamConfig = async (req, res) => {
  try {
    const { id } = req.params;

    // TODO: Verificar que el usuario sea admin o creador del live
    // if (!req.user.isAdmin) return res.status(403).json({message: "No autorizado"});

    const live = await Live.findByPk(id);
    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    res.json({
      title: live.title,
      ingestEndpoint: live.aws_ingest_endpoint,
      streamKey: live.aws_stream_key,
      playbackUrl: live.aws_playback_url,
      instructions: {
        obs: {
          server: live.aws_ingest_endpoint,
          streamKey: live.aws_stream_key,
        },
        note: "Configura estos valores en OBS Studio > Settings > Stream",
      },
    });
  } catch (error) {
    console.error("Error al obtener configuración:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ========================
// Actualizar un Live
// ========================
const updateLive = async (req, res) => {
  try {
    const { id } = req.params;
    const live = await Live.findByPk(id);

    if (!live) return res.status(404).json({ message: "Live no encontrado" });

    // No permitir actualizar campos de AWS
    const { aws_channel_arn, aws_playback_url, aws_stream_key, ...updateData } =
      req.body;

    await live.update(updateData);

    // Si hay nueva imagen → subir y reemplazar
    if (req.file) {
      const s3Key = await uploadToS3("lives", req.file, id);
      live.thumbnail_url = s3Key;
      await live.save();
    }

    res.json({
      message: "Live actualizado correctamente",
      live: {
        ...live.toJSON(),
        thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
        aws_stream_key: undefined,
      },
    });
  } catch (error) {
    console.error("Error al actualizar live:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ========================
// Eliminar un Live
// ========================
const deleteLive = async (req, res) => {
  try {
    const { id } = req.params;
    const live = await Live.findByPk(id);

    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    await live.destroy();

    res.json({ message: "Live eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar live:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// ========================
// Actualizar estado del Live
// ========================
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ["scheduled", "live", "ended", "cancelled"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Estado inválido" });
    }

    const live = await Live.findByPk(id);
    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    live.status = status;
    await live.save();

    res.json({
      message: `Estado actualizado a ${status}`,
      live: {
        ...live.toJSON(),
        thumbnail_url: live.thumbnail_url ? getS3Url(live.thumbnail_url) : null,
        aws_stream_key: undefined,
      },
    });
  } catch (error) {
    console.error("Error al actualizar estado del live:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

const handleIvsWebhook = async (req, res) => {
  try {
    const event = req.body;

    console.log("📡 Webhook IVS recibido");
    console.log(JSON.stringify(event, null, 2));

    // Validación mínima
    if (!event?.detail || !event?.resources?.length) {
      console.warn("⚠️ Evento IVS inválido");
      return res.status(200).json({ message: "Evento inválido" });
    }

    const eventType = event["detail-type"];
    const eventName = event.detail.event_name;
    const channelArn = event.resources[0];
    const streamId = event.detail.stream_id || null;

    // Hora del evento (UTC)
    const eventTimeUtc = new Date(event.time);

    if (eventType !== "IVS Stream State Change") {
      return res.status(200).json({ message: "Evento ignorado" });
    }

    switch (eventName) {
      case "Stream Start":
        await handleStreamStart({
          channelArn,
          streamId,
          startedAt: eventTimeUtc,
        });
        break;

      case "Stream End":
        await handleStreamEnd({
          channelArn,
          endedAt: eventTimeUtc,
        });
        break;

      case "Stream Failure":
        await handleStreamFailure({
          channelArn,
          failedAt: eventTimeUtc,
        });
        break;

      default:
        console.log(`ℹ️ Evento IVS no manejado: ${eventName}`);
    }

    return res.status(200).json({
      message: "Webhook IVS procesado correctamente",
      eventName,
      channelArn,
    });
  } catch (error) {
    console.error("❌ Error procesando webhook IVS:", error);

    // ⚠️ Siempre 200 para EventBridge
    return res.status(200).json({
      message: "Error interno, evento recibido",
    });
  }
};

/* ======================================================
   Handlers auxiliares
   ====================================================== */

const handleStreamStart = async ({ channelArn, streamId }) => {
  try {
    const now = nowCdmx();

    // A) Si fue una reconexión dentro del Grace Period, cancelamos el timer de cierre
    cancelDisconnect(channelArn);

    // B) Buscar si la transmisión ya estaba activa (Caso: Reconexión de OBS)
    let live = await Live.findOne({
      where: {
        aws_channel_arn: channelArn,
        status: "live",
      },
    });

    if (live) {
      console.log(`🔄 Reconexión exitosa para Live #${live.id}`);
      await live.update({ current_stream_id: streamId });

      const io = getIO();
      // Aseguramos que el poller siga corriendo
      startPoller(io, live.id, channelArn);

      // Avisar al frontend que la señal volvió
      io.emit("live_reconnected", {
        liveId: live.id,
        status: "live",
      });
      return;
    }

    // C) Si es un inicio nuevo desde 'scheduled'
    const minTime = now.clone().subtract(30, "minutes").toDate();
    const maxTime = now.clone().add(15, "minutes").toDate();

    live = await Live.findOne({
      where: {
        aws_channel_arn: channelArn,
        status: "scheduled",
        start_time: {
          [Op.between]: [minTime, maxTime],
        },
      },
      order: [["start_time", "ASC"]],
    });

    if (!live || live.current_stream_id) return;

    await live.update({
      status: "live",
      stream_started_at: now.toDate(),
      current_stream_id: streamId,
    });

    const io = getIO();
    io.emit("live_started", {
      liveId: live.id,
      status: "live",
      startedAt: now.toISOString(),
    });

    startPoller(io, live.id, channelArn);

    // 5. Notificaciones push en segundo plano (fire & forget)
    (async () => {
      try {
        // 1. Buscar usuarios objetivo (rol 4, suscritos, excluyendo al creador)
        const usersWithTokens = await User.findAll({
          where: { roleId: 4, isSubscribed: true },
          attributes: ["id"],
          include: [
            {
              model: NotificationToken,
              as: "NotificationTokens",
              where: { isActive: true },
              attributes: ["token"],
              required: false, // Permite traer usuarios para notif en BD/Socket aunque no tengan Push Token
            },
          ],
        });

        if (usersWithTokens.length > 0) {
          const notifTitle = "🎥 Transmisión en Vivo 🔴";
          const notifBody = live.title
            ? `"${live.title}" está en vivo en este momento.`
            : "Una nueva clase en vivo está transmitiéndose ahora.";
          const notifUrl = `/detalle-live/${live.id}`;

          // 1. Crear las notificaciones en la DB en lote
          const createdNotifications = await Notifications.bulkCreate(
            usersWithTokens.map((u) => ({
              userId: u.id,
              actorId: null,
              type: "live",
              entityId: live.id,
              title: notifTitle,
              body: notifBody,
              url: notifUrl,
              data: { liveId: live.id },
            })),
            { returning: true }
          );

          // 2. Emitir por Socket en tiempo real a los usuarios conectados
          createdNotifications.forEach((notif) => {
            emitNotification(notif.userId, notif);
          });

          // 3. Recolectar tokens activos para Push (Firebase FCM)
          const allTokens = usersWithTokens.flatMap((u) =>
            (u.NotificationTokens || []).map((t) => t.token)
          );

          // 🔍 LOG DE DEPURACIÓN (Útil para validar en consola local)
          console.log(
            `🚀 Intentando enviar Push a ${allTokens.length} dispositivo(s)...`
          );

          if (allTokens.length > 0) {
            // Enviar en lotes de 500 (límite de FCM Multicast)
            for (let i = 0; i < allTokens.length; i += 500) {
              const batch = allTokens.slice(i, i + 500);
              await sendPushNotificationMulticast({
                tokens: batch,
                title: notifTitle,
                body: notifBody,
                data: { type: "live", liveId: String(live.id), url: notifUrl },
              }).catch((err) => {
                console.error("❌ Error enviando lote Push:", err);
              });
            }
          }
        }
      } catch (err) {
        console.error("❌ Error en Notificaciones live:", err);
      }
    })();

    console.log(`✅ Live #${live.id} iniciado exitosamente.`);
  } catch (error) {
    console.error("❌ Error en handleStreamStart:", error);
  }
};

const handleStreamEnd = async ({ channelArn }) => {
  try {
    const live = await Live.findOne({
      where: { aws_channel_arn: channelArn, status: "live" },
    });

    if (!live) {
      console.warn("⚠️ No hay live activo para procesar Stream End");
      return;
    }

    // Notificar al frontend inmediatamente que hay un microcorte/reconexión en proceso
    const io = getIO();
    io.emit("live_reconnecting", {
      liveId: live.id,
      message: "Se perdió la señal momentáneamente, intentando reconectar...",
    });

    // Agendamos el cierre definitivo en 90 segundos si OBS no vuelve
    scheduleDisconnect(
      channelArn,
      async () => {
        const now = nowCdmx();
        await live.update({
          status: "ended",
          stream_ended_at: now.toDate(),
          current_stream_id: null,
        });

        stopPoller(live.id);

        io.emit("live_ended", {
          liveId: live.id,
          endedAt: now.toISOString(),
        });

        console.log(
          `🔴 Live #${live.id} finalizado tras expirar el Grace Period (30s).`
        );
      },
      30000
    ); // 30 segundos de tolerancia
  } catch (error) {
    console.error("❌ Error en handleStreamEnd:", error);
  }
};

const handleStreamFailure = async ({ channelArn, failedAt }) => {
  // Mismo tratamiento con Grace Period para caídas de red bruscas
  try {
    const live = await Live.findOne({
      where: { aws_channel_arn: channelArn, status: "live" },
    });

    if (!live) return;

    const io = getIO();
    io.emit("live_reconnecting", { liveId: live.id });

    scheduleDisconnect(
      channelArn,
      async () => {
        stopPoller(live.id);

        await live.update({
          status: "error",
          stream_ended_at: failedAt,
          current_stream_id: null,
        });

        io.emit("live_error", {
          liveId: live.id,
          failedAt,
        });

        console.log(
          `⚠️ Live #${live.id} marcado como ERROR tras expirar Grace Period.`
        );
      },
      60000
    );
  } catch (error) {
    console.error("❌ Error en handleStreamFailure:", error);
  }
};

const getLiveViewers = async (req, res) => {
  try {
    const { id } = req.params;

    const live = await Live.findByPk(id, {
      attributes: ["id", "title", "status", "aws_channel_arn"],
    });

    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    if (live.status !== "live") {
      return res.json({
        liveId: live.id,
        viewers: 0,
        isLive: false,
        status: live.status,
      });
    }

    const streamData = await getStreamViewers(live.aws_channel_arn);

    return res.json({
      liveId: live.id,
      viewers: streamData.viewers,
      isLive: streamData.isLive,
      health: streamData.health,
      startedAt: streamData.startedAt,
      status: live.status,
    });
  } catch (error) {
    console.error("❌ Error al obtener viewers:", error);
    return res.status(500).json({
      message: "Error al obtener viewers",
      error: error.message,
    });
  }
};

const createCommentLive = async (req, res) => {
  try {
    const { liveId } = req.params;
    const { message } = req.body;
    const userName = req.user.name || "Alumna"; // Nombre del usuario logueado desde el JWT

    const newComment = await LiveComment.create({
      live_id: liveId,
      user_name: userName,
      message,
    });

    return res.status(201).json({ success: true, comment: newComment });
  } catch (error) {
    console.error("❌ Error guardando comentario:", error);
    return res.status(500).json({ error: "Error al guardar el comentario" });
  }
};

const getCommentsLive = async (req, res) => {
  try {
    const { liveId } = req.params;

    const comments = await LiveComment.findAll({
      where: { live_id: liveId },
      order: [["createdAt", "desc"]],
      limit: 50, // Límite de seguridad
    });

    return res.status(200).json(comments);
  } catch (error) {
    console.error("❌ Error en getCommentLive:", error);
    return res.status(500).json({
      message: "Ocurrió un error al obtener los mensajes del live",
      error: error.message,
    });
  }
};

module.exports = {
  createLive,
  getAllLives,
  getLiveById,
  getStreamStatus, // NUEVO
  getStreamConfig, // NUEVO
  updateLive,
  updateStatus,
  deleteLive,
  handleIvsWebhook,
  getLiveViewers,
  getCommentsLive,
  createCommentLive,
};
