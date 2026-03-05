const cron = require("node-cron");
const { Op } = require("sequelize");
const { Subscription, User, sequelize } = require("../models"); // Importamos sequelize para la transacción

const TIMEZONE = "America/Mexico_City";

const expireSubscriptionsJob = cron.schedule(
  "0 3 * * *",
  async () => {
    console.log(
      "🕒 Ejecutando cron: revisión de suscripciones ONETIME vencidas",
    );

    // Iniciamos una transacción para que todo sea atómico y seguro
    const t = await sequelize.transaction();

    try {
      const now = new Date();

      // 1️⃣ Buscamos las suscripciones que deben expirar
      const expiredSubscriptions = await Subscription.findAll({
        where: {
          subscription_type: "ONETIME",
          status: "active",
          end_date: { [Op.lt]: now },
        },
        transaction: t,
      });

      if (expiredSubscriptions.length === 0) {
        console.log("📦 No hay suscripciones ONETIME vencidas hoy.");
        await t.commit();
        return;
      }

      const subIds = expiredSubscriptions.map((sub) => sub.id);
      const userIds = expiredSubscriptions.map((sub) => sub.userId); // Confirmado: es userId

      console.log(`📦 Expirando ${subIds.length} suscripciones...`);

      // 2️⃣ Actualizamos todas las suscripciones a 'expired' de un solo golpe
      await Subscription.update(
        { status: "expired" },
        {
          where: { id: { [Op.in]: subIds } },
          transaction: t,
        },
      );

      // 3️⃣ Revocamos el acceso a todos los usuarios afectados de un solo golpe
      await User.update(
        { isSubscribed: false },
        {
          where: { id: { [Op.in]: userIds } },
          transaction: t,
        },
      );

      // Si todo salió bien, guardamos cambios
      await t.commit();
      console.log(
        "✅ Cron finalizado: Usuarios actualizados y suscripciones expiradas.",
      );
    } catch (error) {
      // Si hay un error de conexión (ECONNRESET) o de SQL, deshacemos todo
      if (t) await t.rollback();
      console.error("❌ Error en el cron de expiración:", error);
    }
  },
  {
    scheduled: true,
    timezone: TIMEZONE,
  },
);

module.exports = expireSubscriptionsJob;
