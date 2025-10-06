const multer = require("multer");

const storage = multer.memoryStorage(); // memoria antes de enviar a S3
const upload = multer({ storage });

module.exports = upload;
