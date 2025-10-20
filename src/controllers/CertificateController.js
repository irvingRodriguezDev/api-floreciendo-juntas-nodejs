// controllers/certificateController.js
const { Progress } = require("../models");

const getCertificate = async (req, res) => {
  try {
    const { userId, courseId } = req.params;

    const progress = await Progress.findOne({
      where: { userId, courseId },
    });

    if (!progress || !progress.completed) {
      return res
        .status(400)
        .json({ error: "El curso no está completado aún." });
    }

    // Aquí podrías generar un certificado PDF real
    // o devolver datos para mostrarlo visualmente en el frontend
    res.json({
      message: "Certificado disponible",
      certificateUrl: `/certificates/${userId}_${courseId}.pdf`,
      date: new Date(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener el certificado" });
  }
};

module.exports = {
  getCertificate,
};
