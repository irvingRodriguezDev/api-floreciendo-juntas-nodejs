// controllers/VideoController.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const CourseVideo = require("../models/CourseVideo");
const s3 = new S3Client({ region: "us-east-2" });
const BUCKET_NAME = "floreciendo-videos-cursos";

// Generar presigned URL (para subir directamente desde el frontend)
const generatePresignedUrl = async (req, res) => {
  const { fileName, fileType } = req.body;
  if (!fileName || !fileType) {
    return res
      .status(400)
      .json({ message: "fileName y fileType son obligatorios" });
  }

  const key = `videos/${Date.now()}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: fileType,
  });

  try {
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return res.json({ presignedUrl, key });
  } catch (error) {
    console.error("Error generando presigned URL:", error);
    return res.status(500).json({ message: "Error generando presigned URL" });
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
  try {
    const { courseId, s3Key, cloudfrontUrl, durationSeconds, sizeBytes } =
      req.body;

    if (!courseId || !s3Key) {
      return res.status(400).json({
        message: "Los campos 'courseId' y 's3Key' son obligatorios.",
      });
    }

    // Buscamos el video por courseId (ya que es relación 1:1)
    let video = await CourseVideo.findOne({ where: { courseId } });

    if (!video) {
      // Si no existe, lo creamos (por si Lambda es la primera que envía el registro)
      video = await CourseVideo.create({
        courseId,
        s3Key,
        cloudfrontUrl,
        durationSeconds,
        sizeBytes,
        status: "listo",
      });
    } else {
      // Si existe, lo actualizamos
      await video.update({
        s3Key,
        cloudfrontUrl,
        durationSeconds,
        sizeBytes,
        status: "listo",
      });
    }

    return res.status(200).json({
      message: "Video actualizado correctamente",
      video,
    });
  } catch (error) {
    console.error("Error al actualizar el video:", error);
    return res.status(500).json({
      message: "Error interno al actualizar el video",
      error: error.message,
    });
  }
};

module.exports = {
  generatePresignedUrl,
  uploadLargeVideo,
  updateVideo,
};
