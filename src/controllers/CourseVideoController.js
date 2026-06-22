const { CourseVideo } = require("../models");
const { uploadToS3 } = require("../config/s3");

// Subir video
const MAX_SIZE_GB = 20;
const uploadVideo = async (req, res) => {
  try {
    const { courseId, title, order } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ msg: "Video requerido" });

    const url = await uploadToS3(file, "videos");

    // Guardar en DB
    const [video, created] = await CourseVideo.findOrCreate({
      where: { courseId },
      defaults: {
        courseId,
        title,
        order,
        s3Key: file.originalname,
        cloudfrontUrl: url,
        status: "listo",
        sizeBytes: file.size,
      },
    });

    if (!created) {
      // Si ya existía, actualizar
      await video.update({
        s3Key: file.originalname,
        cloudfrontUrl: url,
        status: "listo",
        sizeBytes: file.size,
      });
    }

    return res.json(video);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ msg: "Error al subir video", error: error.message });
  }
};

module.exports = { uploadVideo };
