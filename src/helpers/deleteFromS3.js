const AWS = require("@aws-sdk/client-s3");

// Configurar el cliente de S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/**
 * Elimina un archivo de S3 usando su path completo o parcial.
 *
 * @param {string} path - La ruta del archivo dentro del bucket (por ejemplo: "courses/image.jpg" o "/courses/image.jpg")
 * @returns {Promise<boolean>} - true si se eliminó correctamente, false si ocurrió un error
 */
const deleteFromS3 = async (path) => {
  if (!path) return false;

  try {
    // Asegura que el path no empiece con "/"
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: normalizedPath,
    };

    await s3.deleteObject(params);

    console.log(`🗑️ Archivo eliminado de S3: ${normalizedPath}`);
    return true;
  } catch (error) {
    console.error("❌ Error eliminando archivo de S3:", error.message);
    return false;
  }
};

module.exports = deleteFromS3;
