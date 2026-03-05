const { PointEvent, User, sequelize } = require("../models");

const addPoints = async (
  userId,
  points,
  actionType,
  referenceId = null,
  description = null,
  transaction = null,
) => {
  try {
    // 1. Verificación rápida (SIN LOCK)
    // Solo bloqueamos si es estrictamente necesario, pero para puntos de "comunidad"
    // es mejor dejar que la base de datos fluya.
    if (referenceId !== null) {
      const exists = await PointEvent.findOne({
        where: {
          user_id: userId,
          action_type: actionType,
          reference_id: referenceId,
        },
        transaction,
        attributes: ["id"], // Solo pedimos el ID para no traer toda la fila
      });

      if (exists) return false;
    }

    // 2. Operaciones en paralelo (Opcional dentro de la misma transacción)
    // Usamos Promise.all para que el INSERT y el UPDATE ocurran lo más cerca posible
    await Promise.all([
      PointEvent.create(
        {
          user_id: userId,
          points,
          action_type: actionType,
          reference_id: referenceId,
          description,
        },
        { transaction },
      ),
      User.update(
        {
          total_points: sequelize.literal(`total_points + ${points}`),
        },
        {
          where: { id: userId },
          transaction,
        },
      ),
    ]);

    return true;
  } catch (error) {
    console.error("❌ Error en addPoints:", error);
    // Si falla la suma de puntos, no queremos que se caiga todo el Post o Like
    // dependiendo de qué tan crítico sea para ti el balance.
    return false;
  }
};

module.exports = { addPoints };
