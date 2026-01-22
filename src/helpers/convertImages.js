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
  if (file.mimetype.startsWith("image/")) {
    const buffer = await sharp(file.buffer).webp({ quality: 85 }).toBuffer();

    const newName = file.originalname.replace(
      path.extname(file.originalname),
      ".webp",
    );

    return {
      ...file,
      buffer,
      mimetype: "image/webp",
      originalname: newName,
    };
  }

  // Videos u otros archivos → sin tocar
  return file;
};

module.exports = convertImageIfNeeded;
