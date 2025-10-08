const multer = require("multer");
const { Upload } = require("@aws-sdk/lib-storage");
const s3Client = require("../config/s3");
const path = require("path");

// Guardar el archivo temporalmente en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToS3 = async (file, folder) => {
  const fileName = `${Date.now()}-${file.originalname}`;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      // ACL: "public-read",
    },
  });

  await upload.done();
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${folder}/${fileName}`;
};

module.exports = { upload, uploadToS3 };
