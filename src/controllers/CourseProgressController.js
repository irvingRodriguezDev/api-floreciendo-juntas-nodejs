// controllers/progressController.js
const { CourseProgress } = require("../models");

const getProgress = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const courseId = parseInt(req.params.courseId, 10);

    const userProgress = await CourseProgress.findOne({
      where: { userId, courseId },
    });

    if (!userProgress) {
      return res.json({ progress: 0, completed: false });
    }

    res.json({
      progress: parseFloat(userProgress.percent), // convertir de string a número
      completed: !!userProgress.completedAt, // true si ya se completó
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener el progreso" });
  }
};

const updateProgress = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const courseId = parseInt(req.params.courseId, 10);
    const { secondsWatched, totalSeconds } = req.body; // totalSeconds = duración del video

    // calcular porcentaje basado en segundos vistos
    const percent =
      totalSeconds > 0 ? (secondsWatched / totalSeconds) * 100 : 0;

    let userProgress = await CourseProgress.findOne({
      where: { userId, courseId },
    });

    if (!userProgress) {
      userProgress = await CourseProgress.create({
        userId,
        courseId,
        lastWatchedSeconds: secondsWatched,
        percent: percent.toFixed(2),
        completedAt: percent >= 100 ? new Date() : null,
      });
    } else {
      // solo actualiza si los segundos vistos son mayores a los anteriores
      if (secondsWatched > userProgress.lastWatchedSeconds) {
        userProgress.lastWatchedSeconds = secondsWatched;
        userProgress.percent = percent.toFixed(2);
        if (percent >= 100) userProgress.completedAt = new Date();
        await userProgress.save();
      }
    }

    res.json(userProgress);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar el progreso" });
  }
};
module.exports = {
  updateProgress,
  getProgress,
};
