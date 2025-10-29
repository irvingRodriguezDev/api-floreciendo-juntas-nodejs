const multer = require("multer");
const { Upload } = require("@aws-sdk/lib-storage");
const s3Client = require("../config/s3");
const path = require("path");

const storage = multer.memoryStorage();
const upload = multer({ storage });

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

module.exports = { upload, uploadToS3 };
