const sharp = require("sharp");
const heicConvert = require("heic-convert");
const path = require("path");

const convertImageIfNeeded = async (file) => {
  // Si es HEIC / HEIF
  if (file.mimetype === "image/heic" || file.mimetype === "image/heif") {
    const outputBuffer = await heicConvert({
      buffer: file.buffer,
      format: "JPEG",
      quality: 0.9,
    });

    const newName = file.originalname.replace(
      path.extname(file.originalname),
      ".jpg",
    );

    return {
      ...file, // 👈 mantiene contrato multer
      buffer: outputBuffer,
      mimetype: "image/jpeg",
      originalname: newName,
    };
  }

  // Otras imágenes → WEBP (opcional)
  // Optimización universal de imágenes
  if (file.mimetype.startsWith("image/")) {
    const buffer = await sharp(file.buffer)
      .rotate() // Respeta orientación EXIF
      .resize({
        width: 1400,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({
        quality: 72,
        effort: 4,
      })
      .toBuffer();

    return {
      ...file,
      buffer,
      mimetype: "image/webp",
      originalname: file.originalname.replace(
        path.extname(file.originalname),
        ".webp",
      ),
      size: buffer.length,
    };
  }

  // Videos u otros archivos → sin tocar
  return file;
};

module.exports = convertImageIfNeeded;
