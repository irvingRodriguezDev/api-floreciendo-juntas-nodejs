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
const { User, Course } = require("../models");
const { sendNotificationToUsers } = require("../services/notificationService");
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
        { where: { courseId }, transaction: t }
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
        { transaction: t }
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
  const { hls_url, status } = req.body;

  try {
    if (!videoId) return res.status(400).json({ message: "ID obligatorio" });

    const video = await CourseVideo.findByPk(videoId);
    const course = await Course.findOne({ where: { id: video.courseId } });

    if (!video) return res.status(404).json({ message: "Video no encontrado" });

    if (!video.is_active) {
      return res.status(400).json({ message: "Video inactivo" });
    }

    const wasReady = video.status === "listo";
    const isReadyNow = (status || "listo") === "listo";

    // 1️⃣ Actualización rápida del video
    await video.update({
      cloudfrontUrl: hls_url,
      status: status || "listo",
    });

    // 2️⃣ Respuesta inmediata al Webhook
    res.json({ message: "Video actualizado correctamente" });

    // 3️⃣ Procesamiento de notificaciones en Background 🚀
    if (!wasReady && isReadyNow) {
      (async () => {
        try {
          const subscribers = await User.findAll({
            where: {
              roleId: 4,
              isSubscribed: true,
            },
            attributes: ["id"],
            raw: true,
          });

          const recipientIds = subscribers.map((u) => u.id);

          if (recipientIds.length > 0) {
            // 2. El helper se encarga de BD, WebSockets, buscar Tokens FCM y lotes de 500
            await sendNotificationToUsers({
              recipientIds,
              actorId: null,
              type: "course",
              entityId: video.id,
              title: "🎬 ¡Nueva clase disponible!",
              body: `Ya puedes ver el nuevo contenido de "${course.title}". ¡Entra ahora!`,
              url: `/detalle-curso/${video.courseId}`,
              extraData: { videoId: video.id, courseId: video.courseId },
            });
          }
        } catch (err) {
          console.error("❌ Error en Notificaciones de video publicado:", err);
        }
      })();
    }
  } catch (error) {
    console.error("❌ updateVideo error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Ocurrió un error" });
  }
};
const initMultipartUpload = async (req, res) => {
  const { fileName, fileType, courseId, durationSeconds, title, order } =
    req.body;

  if (
    !fileName ||
    !fileType ||
    !courseId ||
    !durationSeconds ||
    !title ||
    !order
  ) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (!fileType.startsWith("video/")) {
    return res.status(400).json({ message: "Tipo de archivo inválido" });
  }

  try {
    const result = await sequelize.transaction(async (t) => {
      // 1️⃣ Desactivar videos anteriores
      await CourseVideo.update(
        { is_active: true },
        { where: { courseId }, transaction: t }
      );

      // 2️⃣ Crear registro del video (🔥 IGUAL QUE ANTES)
      const video = await CourseVideo.create(
        {
          courseId,
          s3Key: "PENDING",
          status: "subiendo",
          is_active: true,
          durationSeconds,
          title,
          order,
        },
        { transaction: t }
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
      { where: { id: result.videoId } }
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
      { where: { id: videoId } }
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
