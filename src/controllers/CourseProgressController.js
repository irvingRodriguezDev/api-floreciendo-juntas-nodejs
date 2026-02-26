// controllers/progressController.js
const { CourseProgress } = require("../models");
const { addPoints } = require("../utils/addPoints");

const getProgress = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const courseId = Number(req.params.courseId);

    const userProgress = await CourseProgress.findOne({
      where: { userId, courseId },
    });

    if (!userProgress) {
      return res.json({
        certificate_enabled: false,
        lastWatchedSeconds: 0,
      });
    }

    res.json({
      certificate_enabled: userProgress.certificateEnabled,
      lastWatchedSeconds: userProgress.lastWatchedSeconds || 0,
    });
  } catch (error) {
    console.error("getProgress error:", error);
    res.status(500).json({ error: "Error al obtener el progreso" });
  }
};

const updateProgress = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const courseId = Number(req.params.courseId);

    const { secondsWatched = 0, certificate_enabled = false } = req.body;

    // ✅ Todo en una sola transacción — 1 conexión para todo el flujo
    await sequelize.transaction(async (t) => {
      let userProgress = await CourseProgress.findOne({
        where: { userId, courseId },
        transaction: t,
      });

      if (!userProgress) {
        userProgress = await CourseProgress.create(
          {
            userId,
            courseId,
            lastWatchedSeconds: secondsWatched,
            percent: certificate_enabled ? 100 : 0,
            certificateEnabled: certificate_enabled,
            completedAt: certificate_enabled ? new Date() : null,
          },
          { transaction: t },
        );

        if (certificate_enabled) {
          await addPoints(
            userId,
            10,
            "course_completed",
            courseId,
            "Completó el curso",
            t,
          );
        }

        return res.json(userProgress);
      }

      if (userProgress.certificateEnabled) {
        return res.json(userProgress);
      }

      if (certificate_enabled) {
        userProgress.lastWatchedSeconds = secondsWatched;
        userProgress.percent = 100;
        userProgress.certificateEnabled = true;
        userProgress.completedAt = new Date();

        await userProgress.save({ transaction: t });

        await addPoints(
          userId,
          10,
          "course_completed",
          courseId,
          "Completó el curso",
          t,
        );
      }

      return res.json(userProgress);
    });
  } catch (error) {
    console.error("updateProgress error:", error);
    res.status(500).json({ error: "Error al actualizar el progreso" });
  }
};

module.exports = {
  updateProgress,
  getProgress,
};
