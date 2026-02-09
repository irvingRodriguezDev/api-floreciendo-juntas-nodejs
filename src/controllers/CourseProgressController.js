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

    const {
      secondsWatched = 0,
      certificate_enabled = false, // viene true SOLO al cruzar 80%
    } = req.body;

    let userProgress = await CourseProgress.findOne({
      where: { userId, courseId },
    });

    // 🆕 Crear registro si no existe
    if (!userProgress) {
      userProgress = await CourseProgress.create({
        userId,
        courseId,
        lastWatchedSeconds: secondsWatched,
        percent: certificate_enabled ? 100 : 0,
        certificateEnabled: certificate_enabled,
        completedAt: certificate_enabled ? new Date() : null,
      });

      if (certificate_enabled) {
        await addPoints(
          userId,
          10,
          "course_completed",
          courseId,
          "Completó el curso",
        );
      }

      return res.json(userProgress);
    }

    // 🔒 Si ya está completado → NO TOCAR
    if (userProgress.certificateEnabled) {
      return res.json(userProgress);
    }

    // 🎯 Primera vez que cruza el 80%
    if (certificate_enabled) {
      userProgress.lastWatchedSeconds = secondsWatched;
      userProgress.percent = 100; // 👈 COMPLETADO REAL
      userProgress.certificateEnabled = true;
      userProgress.completedAt = new Date();

      await userProgress.save();

      await addPoints(
        userId,
        10,
        "course_completed",
        courseId,
        "Completó el curso",
      );
    }

    return res.json(userProgress);
  } catch (error) {
    console.error("updateProgress error:", error);
    res.status(500).json({ error: "Error al actualizar el progreso" });
  }
};

module.exports = {
  updateProgress,
  getProgress,
};
