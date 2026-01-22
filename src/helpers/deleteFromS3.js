const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Elimina un archivo de S3 usando su key
 * @param {string} path - Ej: "post-media/uuid.webp"
 */
const deleteFromS3 = async (path) => {
  if (!path) return false;

  try {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: normalizedPath,
      }),
    );

    console.log(`🗑️ Archivo eliminado de S3: ${normalizedPath}`);
    return true;
  } catch (error) {
    console.error("❌ Error eliminando archivo de S3:", error);
    return false;
  }
};

module.exports = deleteFromS3;
