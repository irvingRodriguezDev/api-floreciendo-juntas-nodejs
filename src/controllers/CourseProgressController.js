// controllers/progressController.js
const { CourseProgress } = require("../models");
const { addPoints } = require("../utils/addPoints");
const sequelize = require("../config/db");

const getProgress = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const courseId = Number(req.params.courseId);

    if (isNaN(userId)) {
      return res
        .status(400)
        .json({ error: "El ID de usuario proporcionado no es válido" });
    }
    const userProgress = await CourseProgress.findOne({
      where: { userId, courseId },
    });

    if (!userProgress) {
      return res.json({
        certificate_enabled: false,
        lastWatchedSeconds: 0,
        percent: 0, // <-- Incluimos el porcentaje
      });
    }

    res.json({
      certificate_enabled: userProgress.certificateEnabled,
      lastWatchedSeconds: userProgress.lastWatchedSeconds || 0,
      percent: userProgress.percent || 0, // <-- Incluimos el porcentaje guardado
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
      percent = 0,
      certificate_enabled = false,
    } = req.body;

    let result;

    await sequelize.transaction(async (t) => {
      // 1. findOrCreate evita la condición de carrera a nivel de BD
      const [userProgress, created] = await CourseProgress.findOrCreate({
        where: { userId, courseId },
        defaults: {
          lastWatchedSeconds: secondsWatched,
          percent: certificate_enabled ? 100 : percent,
          certificateEnabled: certificate_enabled,
          completedAt: certificate_enabled ? new Date() : null,
        },
        transaction: t,
        lock: t.LOCK.UPDATE, // Bloquea la fila para evitar escrituras concurrentes
      });

      // 2. Si recién se creó el registro
      if (created) {
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
        result = userProgress;
        return;
      }

      // 3. Si ya existía y ya tiene certificado, no modificamos nada
      if (userProgress.certificateEnabled) {
        result = userProgress;
        return;
      }

      // 4. Si ya existía, actualizamos asegurando que porcentaje y segundos nunca retrocedan
      const newPercent = certificate_enabled
        ? 100
        : Math.max(userProgress.percent || 0, percent);
      const newSeconds = Math.max(
        userProgress.lastWatchedSeconds || 0,
        secondsWatched,
      );

      userProgress.lastWatchedSeconds = newSeconds;
      userProgress.percent = newPercent;

      let shouldAddPoints = false;
      if (certificate_enabled && !userProgress.certificateEnabled) {
        userProgress.certificateEnabled = true;
        userProgress.completedAt = new Date();
        shouldAddPoints = true;
      }

      await userProgress.save({ transaction: t });

      if (shouldAddPoints) {
        await addPoints(
          userId,
          10,
          "course_completed",
          courseId,
          "Completó el curso",
          t,
        );
      }

      result = userProgress;
    });

    return res.json(result);
  } catch (error) {
    console.error("updateProgress error:", error);
    return res.status(500).json({ error: "Error al actualizar el progreso" });
  }
};

module.exports = {
  updateProgress,
  getProgress,
};
