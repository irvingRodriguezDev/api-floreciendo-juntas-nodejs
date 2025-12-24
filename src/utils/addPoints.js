// src/utils/addPoints.js
const { PointEvent, User, sequelize } = require("../models");

const addPoints = async (
  userId,
  points,
  actionType,
  referenceId = null,
  description = null,
  transaction = null
) => {
  // Evitar duplicados SOLO si hay referencia
  if (referenceId !== null) {
    const exists = await PointEvent.findOne({
      where: {
        user_id: userId,
        action_type: actionType,
        reference_id: referenceId,
      },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });

    if (exists) return false;
  }

  // Crear evento
  await PointEvent.create(
    {
      user_id: userId,
      points,
      action_type: actionType,
      reference_id: referenceId,
      description,
    },
    { transaction }
  );

  // 🔥 SUMA GARANTIZADA
  await User.update(
    {
      total_points: sequelize.literal(`total_points + ${points}`),
    },
    {
      where: { id: userId },
      transaction,
    }
  );

  return true;
};

module.exports = { addPoints };
