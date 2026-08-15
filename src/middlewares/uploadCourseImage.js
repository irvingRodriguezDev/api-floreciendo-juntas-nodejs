const multer = require("multer");
const { Upload } = require("@aws-sdk/lib-storage");
const s3Client = require("../config/s3");
const path = require("path");

const storage = multer.memoryStorage();
const upload = multer({ storage });

const handleUpload = (multerMiddleware) => {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        if (err.message === "Request aborted" || err.code === "ECONNABORTED") {
          // Extraemos la metadata para ubicar el origen exacto en los logs
          const contentLength = req.headers["content-length"];
          const sizeMB = contentLength
            ? `${(parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2)} MB`
            : "Desconocido";

          console.warn(`[UPLOAD ABORTED] Cancelación detectada:`, {
            method: req.method,
            route: req.originalUrl || req.url, // Ej: /api/v1/systems/45 o /api/users/profile
            approxSize: sizeMB,
            ip: req.ip || req.headers["x-forwarded-for"],
            userAgent: req.headers["user-agent"],
          });

          return res.status(400).json({
            error:
              "La carga del archivo fue cancelada por el cliente o se perdió la conexión.",
          });
        }

        // Para otros errores de Multer (ej. límite de tamaño o tipo de archivo no permitido)
        console.error(
          `[UPLOAD ERROR] En ruta ${req.method} ${req.originalUrl}:`,
          err.message,
        );
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };
};

const uploadToS3 = async (folder, file, id) => {
  const extension = path.extname(file.originalname); // .jpg, .png, etc.
  const environment = process.env.NODE_ENV || "local";

  // Generar Key usando el id
  const key = `${environment}/${folder}/${id}`;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    },
  });

  await upload.done();

  return `/${key}`; // solo path relativo
};

module.exports = { upload, uploadToS3, handleUpload };
