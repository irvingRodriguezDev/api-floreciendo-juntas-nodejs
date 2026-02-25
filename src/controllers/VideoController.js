// controllers/VideoController.js
const {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const CourseVideo = require("../models/CourseVideo");
const sequelize = require("../config/db");
const { User, Notifications, NotificationToken } = require("../models");
const sendPushNotification = require("../services/sendPushNotification");
const s3 = new S3Client({ region: "us-east-2" });
const BUCKET_NAME = "floreciendo-videos-cursos";

/**
 * Genera una URL firmada para subir un video a S3, creando previamente
 * el registro en la DB para obtener el ID de seguimiento.
 */
const generatePresignedUrl = async (req, res) => {
  const { fileName, fileType, courseId, durationSeconds } = req.body;

  // ✅ Validaciones
  if (!fileName || !fileType || !courseId || !durationSeconds) {
    return res.status(400).json({
      message:
        "fileName, fileType, courseId y durationSeconds son obligatorios",
    });
  }

  if (!fileType.startsWith("video/")) {
    return res.status(400).json({ message: "Tipo de archivo inválido" });
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      // 1️⃣ Desactivar videos anteriores DEL CURSO
      await CourseVideo.update(
        { is_active: false },
        { where: { courseId }, transaction: t },
      );

      // 2️⃣ Crear registro nuevo
      const video = await CourseVideo.create(
        {
          courseId,
          s3Key: "PENDING",
          status: "subiendo",
          is_active: true,
          durationSeconds,
        },
        { transaction: t },
      );

      // 3️⃣ Generar s3Key definitivo
      const safeFileName = fileName.replace(/[^\w.-]/g, "_");
      const s3Key = `videos/${courseId}/${video.id}/${Date.now()}-${safeFileName}`;

      // 4️⃣ Guardar s3Key
      await video.update({ s3Key }, { transaction: t });

      // 🔁 IMPORTANTE: retornar lo que usarás afuera
      return {
        videoId: video.id,
        s3Key,
      };
    });

    // 5️⃣ Generar URL prefirmada (FUERA de la transacción)
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: result.s3Key,
      ContentType: fileType,
      // Opcional pero recomendado
      // ContentLength: maxFileSize,
    });

    const presignedUrl = await getSignedUrl(s3, command, {
      expiresIn: 60 * 60, // 1 hora
    });

    return res.status(200).json({
      message: "URL prefirmada generada correctamente",
      videoId: result.videoId,
      s3Key: result.s3Key,
      presignedUrl,
    });
  } catch (error) {
    console.error("Error generando presigned URL:", error);

    return res.status(500).json({
      message: "Error interno al generar la URL prefirmada",
      error: error.message,
    });
  }
};
const updateVideo = async (req, res) => {
  const videoId = req.params.videoId;
  const { hls_url, status, jobId } = req.body;

  try {
    if (!videoId) {
      return res
        .status(400)
        .json({ message: "El ID del video es obligatorio en la ruta." });
    }

    const video = await CourseVideo.findByPk(videoId);

    if (!video) {
      console.error(`Error: Video con ID ${videoId} no encontrado.`);
      return res
        .status(404)
        .json({ message: `Video con ID ${videoId} no encontrado.` });
    }

    // 🧠 Verificación: solo actualizar si está activo
    if (!video.is_active) {
      return res.status(400).json({
        message:
          "Este video está marcado como inactivo y no puede actualizarse.",
      });
    }
    const updatePayload = {
      cloudfrontUrl: hls_url,
      status: status || "listo",
    };

    await video.update(updatePayload);
    // 🔔 NOTIFICACIONES VIDEO LISTO
    try {
      // Solo notificar si el video acaba de quedar listo
      const wasReady = video.status === "listo";
      const isReadyNow = updatePayload.status === "listo";

      if (!wasReady && isReadyNow) {
        const usersToNotify = await User.findAll({
          where: {
            roleId: 4,
            isSubscribed: true,
          },
          attributes: ["id"],
        });

        if (!usersToNotify.length) return;

        const title = "Nuevo curso disponible 🎬";
        const body = "Un nuevo curso está disponible";
        const url = `/detalle-curso/${video.courseId}`;

        // 1️⃣ Guardar notificaciones en DB
        const notifications = usersToNotify.map((u) => ({
          userId: u.id,
          actorId: null,
          type: "course",
          entityId: video.id,
          title,
          body,
          url,
          data: {
            videoId: video.id,
            courseId: video.courseId,
          },
        }));

        await Notifications.bulkCreate(notifications);

        // 2️⃣ Tokens activos
        const tokens = await NotificationToken.findAll({
          where: {
            isActive: true,
            userId: usersToNotify.map((u) => u.id),
            device: { [Op.ne]: "safari" },
          },
          attributes: ["token"],
        });

        if (!tokens.length) return;

        // 3️⃣ Push (NO BLOQUEANTE 🔥)
        for (const { token } of tokens) {
          sendPushNotification({
            token,
            title,
            body,
            data: {
              type: "course",
              videoId: String(video.id),
              courseId: String(video.courseId),
              url,
            },
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("⚠️ Error enviando notificaciones de video:", err);
    }

    return res
      .json({ message: "El video se ha actualizado correctamente" })
      .status(200);
  } catch (error) {
    return res
      .json({ error: "Ocurrio un error al actualizar el video" })
      .status(500);
  }
};
const initMultipartUpload = async (req, res) => {
  const { fileName, fileType, courseId, durationSeconds } = req.body;

  if (!fileName || !fileType || !courseId || !durationSeconds) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (!fileType.startsWith("video/")) {
    return res.status(400).json({ message: "Tipo de archivo inválido" });
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      // 1️⃣ Desactivar videos anteriores
      await CourseVideo.update(
        { is_active: false },
        { where: { courseId }, transaction: t },
      );

      // 2️⃣ Crear registro del video (🔥 IGUAL QUE ANTES)
      const video = await CourseVideo.create(
        {
          courseId,
          s3Key: "PENDING",
          status: "subiendo",
          is_active: true,
          durationSeconds,
        },
        { transaction: t },
      );

      // 3️⃣ Generar s3Key (🔥 INCLUYE video.id)
      const safeFileName = fileName.replace(/[^\w.-]/g, "_");
      const s3Key = `videos/${video.id}/${Date.now()}-${safeFileName}`;

      await video.update({ s3Key }, { transaction: t });

      return { videoId: video.id, s3Key };
    });

    // 4️⃣ Iniciar multipart en S3
    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: result.s3Key,
      ContentType: fileType,
    });

    const { UploadId } = await s3.send(command);

    // (opcional) guardar uploadId
    await CourseVideo.update(
      { uploadId: UploadId },
      { where: { id: result.videoId } },
    );

    return res.json({
      uploadId: UploadId,
      s3Key: result.s3Key,
      videoId: result.videoId, // 🔥 ESTE ES EL QUE NECESITA LAMBDA
    });
  } catch (error) {
    console.error("Error init multipart:", error);
    return res.status(500).json({ message: "Error iniciando multipart" });
  }
};
const getMultipartPresignedUrl = async (req, res) => {
  const { uploadId, s3Key, partNumber } = req.body;

  if (!uploadId || !s3Key || !Number.isInteger(Number(partNumber))) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const command = new UploadPartCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    UploadId: uploadId,
    PartNumber: Number(partNumber),
  });

  const presignedUrl = await getSignedUrl(s3, command, {
    expiresIn: 3600,
  });

  res.json({ presignedUrl });
};

const completeMultipartUpload = async (req, res) => {
  const { uploadId, s3Key, parts, videoId } = req.body;

  if (!uploadId || !s3Key || !videoId || !parts?.length) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });

    await s3.send(command);

    await CourseVideo.update(
      { status: "subiendo" },
      { where: { id: videoId } },
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error complete multipart:", error);
    res.status(500).json({ message: "Error completando multipart" });
  }
};

module.exports = {
  generatePresignedUrl,
  initMultipartUpload,
  getMultipartPresignedUrl,
  completeMultipartUpload,
  updateVideo,
};
