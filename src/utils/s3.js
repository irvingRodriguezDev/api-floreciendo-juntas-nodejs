const AWS = require("aws-sdk");

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const uploadToS3 = async (file, folder = "videos") => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: `${folder}/${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  const data = await s3.upload(params).promise();
  return data.Location; // URL del archivo subido
};

module.exports = { s3, uploadToS3 };
