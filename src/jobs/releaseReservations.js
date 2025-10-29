const cron = require("node-cron");
const { Ticket, sequelize } = require("../models");

// Ejecutar cada hora
const RELEASE_CRON = "0 * * * *"; // minuto 0 de cada hora
const RESERVATION_MINUTES = 15; // duración máxima de reserva en minutos

const releaseExpiredReservations = async () => {
  try {
    const now = new Date();

    const [updatedCount] = await Ticket.update(
      {
        reserved: false,
        reservation_expires_at: null,
        buyerName: null,
        buyerEmail: null,
      },
      {
        where: {
          reserved: true,
          reservation_expires_at: { [sequelize.Op.lt]: now },
        },
      }
    );

    if (updatedCount > 0) {
      console.log(`🟢 ${updatedCount} boletos liberados (reserva expirada).`);
    }
  } catch (error) {
    console.error("❌ Error liberando reservas expiradas:", error);
  }
};

let task = null;

const start = () => {
  if (!task) {
    task = cron.schedule(RELEASE_CRON, () => {
      console.log("⏱️ Verificando boletos expirados...");
      releaseExpiredReservations();
    });
    console.log("✅ Cron job de liberación de boletos iniciado (cada hora).");
  }
};

module.exports = { start };
