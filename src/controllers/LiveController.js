// controllers/liveController.js
const {
  getIvsChannelConfig,
  createIvsChannel,
  deleteIvsChannel,
  checkStreamIsLive,
} = require("../services/awsIvsService");
const { Op } = require("sequelize");
const { Live } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const moment = require("moment-timezone");
const { getIO } = require("../socket");
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
    // Hora actual CDMX
    const now = nowCdmx();

    // Ventana de tolerancia
    const minTime = now.clone().subtract(30, "minutes").toDate();
    const maxTime = now.clone().add(15, "minutes").toDate();

    const live = await Live.findOne({
      where: {
        aws_channel_arn: channelArn,
        status: "scheduled",
        start_time: {
          [Op.between]: [minTime, maxTime],
        },
      },
      order: [["start_time", "ASC"]], // el más próximo
    });

    if (!live) {
      console.warn("⚠️ No hay live scheduled dentro de la ventana");
      return;
    }
    if (live.current_stream_id) {
      console.warn("⚠️ Stream ya iniciado, ignorando evento duplicado");
      return;
    }
    await live.update({
      status: "live",
      stream_started_at: now.toDate(), // CDMX
      current_stream_id: streamId,
    });

    const io = getIO();
    io.emit("live_started", {
      liveId: live.id,
      status: "live",
      startedAt: now.toISOString(),
    });

    console.log(
      `✅ Live #${live.id} iniciado (start_time: ${moment(
        live.start_time
      ).format("YYYY-MM-DD HH:mm:ss")})`
    );
  } catch (error) {
    console.error("❌ Error en handleStreamStart:", error);
  }
};

const handleStreamEnd = async ({ channelArn }) => {
  try {
    const now = nowCdmx();

    const live = await Live.findOne({
      where: {
        aws_channel_arn: channelArn,
        status: "live",
      },
    });

    if (!live) {
      console.warn("⚠️ No hay live activo para finalizar");
      return;
    }

    // 1️⃣ Actualizar estado del live
    await live.update({
      status: "ended",
      stream_ended_at: now.toDate(),
      current_stream_id: null,
    });

    // 2️⃣ Emitir evento SOCKET 🔥
    const io = getIO();

    io.emit("live_ended", {
      liveId: live.id,
      endedAt: now.toISOString(),
    });

    console.log(`📡 Socket live_ended emitido → live:${live.id}`);

    // 3️⃣ Cleanup opcional
    // await live.destroy();

    console.log(`🔴 Live #${live.id} finalizado correctamente`);
  } catch (error) {
    console.error("❌ Error en handleStreamEnd:", error);
  }
};

const handleStreamFailure = async ({ channelArn, failedAt }) => {
  try {
    const live = await Live.findOne({
      where: {
        aws_channel_arn: channelArn,
        status: "live",
      },
    });

    if (!live) {
      console.warn("⚠️ No hay live activo para marcar error");
      return;
    }

    await live.update({
      status: "error",
      stream_ended_at: failedAt,
      current_stream_id: null,
    });

    console.log(`⚠️ Live #${live.id} marcado como ERROR`);
  } catch (error) {
    console.error("❌ Error en handleStreamFailure:", error);
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
};
