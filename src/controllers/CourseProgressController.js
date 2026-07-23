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
    const { secondsWatched = 0, percent = 0, certificate_enabled = false } = req.body;

    // 1. Declaramos una variable para guardar el resultado
    let result;

    // 2. La transacción solo hace trabajo de DB
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
            percent: certificate_enabled ? 100 : percent,
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
        result = userProgress;
        return; // Terminamos el callback, permitiendo el COMMIT
      }

      if (userProgress.certificateEnabled) {
        result = userProgress;
        return;
      }

      // 🔥 BLINDAJE: Nos aseguramos de que el porcentaje y segundos NUNCA retrocedan
      userProgress.lastWatchedSeconds = Math.max(userProgress.lastWatchedSeconds || 0, secondsWatched);
      userProgress.percent = certificate_enabled ? 100 : Math.max(userProgress.percent || 0, percent);

      if (certificate_enabled) {
        userProgress.certificateEnabled = true;
        userProgress.completedAt = new Date();
      }

      await userProgress.save({ transaction: t });

      if (certificate_enabled) {
        await addPoints(userId, 10, "course_completed", courseId, "Completó el curso", t);
      }

      result = userProgress;
    });

    // 3. ENVIAMOS LA RESPUESTA FUERA (Aquí la conexión ya regresó al pool)
    return res.json(result);
  } catch (error) {
    console.error("updateProgress error:", error);
    // Si la transacción falla, Sequelize hace ROLLBACK automáticamente aquí
    res.status(500).json({ error: "Error al actualizar el progreso" });
  }
};

module.exports = {
  updateProgress,
  getProgress,
};
