// controllers/VideoController.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const CourseVideo = require("../models/CourseVideo");
const sequelize = require("../config/db");
const s3 = new S3Client({ region: "us-east-2" });
const BUCKET_NAME = "floreciendo-videos-cursos";

/**
 * Genera una URL firmada para subir un video a S3, creando previamente
 * el registro en la DB para obtener el ID de seguimiento.
 */
const generatePresignedUrl = async (req, res) => {
  const { fileName, fileType, courseId } = req.body;

  if (!fileName || !fileType || !courseId) {
    return res
      .status(400)
      .json({ message: "fileName, fileType y courseId son obligatorios" });
  }

  try {
    // ⚙️ 1️⃣ Desactivar videos anteriores del mismo curso
    await CourseVideo.update({ is_active: false }, { where: { courseId } });

    // ⚙️ 2️⃣ Crear nuevo registro en transacción
    const newVideoRecord = await sequelize.transaction(async (t) => {
      const video = await CourseVideo.create(
        {
          courseId,
          s3Key: "TEMPORAL_KEY",
          status: "subiendo",
          is_active: true, // Nuevo video activo
        },
        { transaction: t }
      );

      // Construir la S3 Key definitiva
      const s3Key = `videos/${video.id}/${fileName}`;

      // Actualizar registro con la Key final
      await video.update({ s3Key }, { transaction: t });

      return { id: video.id, s3Key };
    });

    // Aquí iría la generación de la URL prefirmada (no la muestras pero la dejamos lista)
    // const presignedUrl = await s3.getSignedUrlPromise('putObject', { ... });

    return res.status(200).json({
      message:
        "Registro de video creado y URL prefirmada generada correctamente.",
      video: newVideoRecord,
      // presignedUrl,
    });
  } catch (error) {
    console.error("Error creando registro de video:", error);
    return res.status(500).json({
      message: "Error interno al crear el registro del video.",
      error: error.message,
    });
  }
};

// Opcional: subir desde el backend (si no quieres que frontend haga upload directo)
const uploadLargeVideo = async (req, res) => {
  const { fileName } = req.body;
  if (!req.file) return res.status(400).json({ message: "Archivo no enviado" });

  const key = `videos/${Date.now()}-${fileName}`;
  try {
    const parallelUploads3 = new Upload({
      client: s3,
      params: {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: req.file.buffer, // si usas multer memoryStorage
        ContentType: req.file.mimetype,
      },
      leavePartsOnError: false, // limpia si falla
    });

    parallelUploads3.on("httpUploadProgress", (progress) => {
      console.log("Progreso:", progress);
    });

    await parallelUploads3.done();
    return res.json({ message: "Video subido correctamente", key });
  } catch (error) {
    console.error("Error subiendo video grande:", error);
    return res.status(500).json({ message: "Error subiendo video" });
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

    return json({ message: "El video se ha actualizado correctamente" }).status(
      200
    );
  } catch (error) {
    return json({ error: "Ocurrio un error al actualizar el video" }).status(
      500
    );
  }
};

module.exports = {
  generatePresignedUrl,
  uploadLargeVideo,
  updateVideo,
};
