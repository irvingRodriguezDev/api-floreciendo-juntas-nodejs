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
  const userId = Number(req.params.userId);
  const courseId = Number(req.params.courseId);
  const {
    secondsWatched = 0,
    percent = 0,
    certificate_enabled = false,
  } = req.body;

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      let result;

      await sequelize.transaction(async (t) => {
        // 1. Buscamos primero sin bloquear rangos
        let userProgress = await CourseProgress.findOne({
          where: { userId, courseId },
          transaction: t,
          lock: t.LOCK.UPDATE, // Aquí SÍ es seguro si la fila ya existe
        });

        let created = false;

        // 2. Si no existe, usamos upsert/create limpio (sin lock explícito)
        if (!userProgress) {
          [userProgress, created] = await CourseProgress.findOrCreate({
            where: { userId, courseId },
            defaults: {
              lastWatchedSeconds: secondsWatched,
              percent: certificate_enabled ? 100 : percent,
              certificateEnabled: certificate_enabled,
              completedAt: certificate_enabled ? new Date() : null,
            },
            transaction: t, // SIN 'lock: t.LOCK.UPDATE' para evitar Gap Locks en la BD
          });
        }

        // 3. Si recién se creó el registro
        if (created) {
          if (certificate_enabled) {
            await addPoints(
              userId,
              100,
              "custom",
              courseId,
              `El usuario con id: ${userId} ha cumpletado el curso con id: ${courseId}`,
              t,
            );
          }
          result = userProgress;
          return;
        }

        // 4. Si ya existía y ya tiene certificado activado, no modificamos nada
        if (userProgress.certificateEnabled) {
          result = userProgress;
          return;
        }

        // 5. Si ya existía, actualizamos asegurando que no retroceda
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
            100,
            "course_completed",
            courseId,
            "Completó el curso",
            t,
          );
        }

        result = userProgress;
      });

      // Éxito: retornamos la respuesta inmediatamente
      return res.json(result);
    } catch (error) {
      attempt++;

      // Si fue un Deadlock de MySQL (código 1213) y nos quedan reintentos, esperamos unos ms y volvemos a intentar
      const isDeadlock =
        error.original?.code === "ER_LOCK_DEADLOCK" ||
        error.parent?.code === "ER_LOCK_DEADLOCK";

      if (isDeadlock && attempt < maxRetries) {
        console.warn(
          `⚠️ Deadlock en updateProgress (intento ${attempt}/${maxRetries}). Reintentando...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 150 + 50),
        ); // Espera aleatoria de 50-200ms
      } else {
        console.error("updateProgress error fatal:", error);
        return res
          .status(500)
          .json({ error: "Error al actualizar el progreso" });
      }
    }
  }
};

module.exports = {
  updateProgress,
  getProgress,
};
