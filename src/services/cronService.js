const cron = require("node-cron");
const { Notifications } = require("../models");
const { Op } = require("sequelize");

/**
 * Tarea programada para limpiar notificaciones
 * Se ejecuta todos los días a las 3:00 AM (0 3 * * *)
 */
const initCronJobs = () => {
  console.log("🚀 Servicio de Cron Jobs iniciado...");

  cron.schedule(
    "0 3 * * *",
    async () => {
      console.log("🕒 Iniciando limpieza automática de notificaciones...");

      try {
        // Calculamos la fecha límite (30 días atrás)
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - 30);

        // Eliminación masiva
        const deleted = await Notifications.destroy({
          where: {
            createdAt: {
              [Op.lt]: limitDate,
            },
          },
        });

        console.log(
          `[${new Date().toLocaleString()}] 🧹 Cron: ${deleted} notificaciones antiguas eliminadas.`,
        );
      } catch (err) {
        console.error("❌ Error en Cron de limpieza:", err);
      }
    },
    {
      scheduled: true,
      timezone: "America/Mexico_City", // 👈 Ajusta esto a tu zona horaria local
    },
  );
};

module.exports = { initCronJobs };
