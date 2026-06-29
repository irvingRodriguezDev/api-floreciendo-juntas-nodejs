const cron = require("node-cron");
const { Notifications, Live, Post } = require("../models");
const { Op } = require("sequelize");
const { getStreamViewers } = require("./awsIvsService");
const { getIO } = require("../socket");

/**
 * Tarea programada para limpiar notificaciones
 * Se ejecuta todos los días a las 3:00 AM (0 3 * * *)
 */
const initCronJobs = () => {
  console.log("🚀 Servicio de Cron Jobs iniciado...");

  // cron.schedule("*/2 * * * *", async () => {
  //   try {
  //     const activeLives = await Live.findAll({
  //       where: { status: "live" },
  //       attributes: ["id", "aws_channel_arn"],
  //     });

  //     if (!activeLives.length) return;

  //     const io = getIO();

  //     for (const live of activeLives) {
  //       try {
  //         const streamData = await getStreamViewers(live.aws_channel_arn);

  //         // 1. Guardar en memoria global para los nuevos usuarios que entren
  //         global.lastIvsViewers[live.id] = streamData.viewers;

  //         // 2. Emitir el objeto estructurado a los que ya están adentro
  //         io.to(`live_${live.id}`).emit("ivs_viewer_count", {
  //           liveId: live.id,
  //           viewers: streamData.viewers,
  //         });

  //         console.log(
  //           `👁 Live #${live.id} → ${streamData.viewers} viewers guardados y emitidos`,
  //         );
  //       } catch (err) {
  //         console.error(`❌ Error viewers live #${live.id}:`, err);
  //       }
  //     }
  //   } catch (err) {
  //     console.error("❌ Error cron viewers:", err);
  //   }
  // });

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

  // Se ejecuta cada hora (ej: 1:00, 2:00, 3:00, etc.)
  cron.schedule("0 * * * *", async () => {
    console.log("🔄 Iniciando limpieza horaria de posts anclados...");

    try {
      const [affectedRows] = await Post.update(
        { isPinned: false, pinnedUntil: null },
        {
          where: {
            isPinned: true,
            pinnedUntil: { [Op.lte]: new Date() },
          },
        },
      );

      if (affectedRows > 0) {
        console.log(`✅ Se desanclaron ${affectedRows} posts expirados.`);
      }
    } catch (error) {
      console.error("❌ Error en la limpieza de posts:", error);
    }
  });
};

module.exports = { initCronJobs };
