const cron = require("node-cron");
const { Notifications, Live } = require("../models");
const { Op } = require("sequelize");
const { getStreamViewers } = require("./awsIvsService");
const { getIO } = require("../socket");

/**
 * Tarea programada para limpiar notificaciones
 * Se ejecuta todos los días a las 3:00 AM (0 3 * * *)
 */
const initCronJobs = () => {
  console.log("🚀 Servicio de Cron Jobs iniciado...");
  // ==============================
  // Viewers en tiempo real cada 2 minutos
  // ==============================
  cron.schedule("*/2 * * * *", async () => {
    try {
      const activeLives = await Live.findAll({
        where: { status: "live" },
        attributes: ["id", "aws_channel_arn"],
      });

      if (!activeLives.length) return;

      const io = getIO();

      for (const live of activeLives) {
        try {
          const streamData = await getStreamViewers(live.aws_channel_arn);
          io.to(`live_${live.id}`).emit("ivs_viewer_count", streamData.viewers);
          console.log(`👁 Live #${live.id} → ${streamData.viewers} viewers`);
        } catch (err) {
          console.error(`❌ Error viewers live #${live.id}:`, err);
        }
      }
    } catch (err) {
      console.error("❌ Error cron viewers:", err);
    }
  });

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

  //se eejecuta cada dia a las 3AM
  cron.schedule("0 3 * * *", async () => {
    console.log("🔄 Iniciando limpieza de posts anclados...");

    const [affectedRows] = await Post.update(
      { isPinned: false, pinnedUntil: null },
      {
        where: {
          isPinned: true,
          pinnedUntil: { [Op.lte]: new Date() }, // Limpia todo lo que expiró antes de este momento
        },
      },
    );

    console.log(`✅ Se desanclaron ${affectedRows} posts.`);
  });
};

module.exports = { initCronJobs };
