const cron = require("node-cron");
const { Op } = require("sequelize");
const { Subscription, User } = require("../models");

// ✅ Forzamos zona horaria a UTC-6 (CDMX)
const TIMEZONE = "America/Mexico_City";

// 🧠 Tarea: Expirar suscripciones ONETIME vencidas
const expireSubscriptionsJob = cron.schedule(
  "0 3 * * *", // Todos los días a las 3:00 AM hora local
  async () => {
    console.log(
      "🕒 Ejecutando cron: revisión de suscripciones ONETIME vencidas"
    );

    try {
      const now = new Date(); // Se evaluará en UTC-6 gracias al timezone configurado

      const expiredSubscriptions = await Subscription.findAll({
        where: {
          type: "ONETIME",
          status: "active",
          end_date: { [Op.lt]: now },
        },
      });

      console.log(`📦 Suscripciones a expirar: ${expiredSubscriptions.length}`);

      for (const sub of expiredSubscriptions) {
        // 1️⃣ Actualizamos el registro de suscripción
        await sub.update({ status: "expired" });

        // 2️⃣ Revocamos acceso al usuario
        const user = await User.findByPk(sub.user_id);
        if (user) {
          await user.update({ isSubscribed: false });
          console.log(`🚫 Acceso revocado a usuario ID: ${user.id}`);
        }
      }

      console.log("✅ Cron finalizado correctamente");
    } catch (error) {
      console.error("❌ Error en el cron de expiración:", error);
    }
  },
  {
    scheduled: true,
    timezone: TIMEZONE, // 👈 importante
  }
);

module.exports = expireSubscriptionsJob;
