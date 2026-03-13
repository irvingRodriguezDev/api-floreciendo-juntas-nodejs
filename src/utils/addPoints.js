const { PointEvent, User, sequelize } = require("../models");

const addPoints = async (
  userId,
  points,
  actionType,
  referenceId = null,
  description = null,
  transaction = null,
) => {
  // Ya NO hay try/catch aquí. Si falla, que explote hacia arriba
  // para que la transacción padre haga rollback correctamente.

  if (referenceId !== null) {
    const exists = await PointEvent.findOne({
      where: {
        user_id: userId,
        action_type: actionType,
        reference_id: referenceId,
      },
      transaction,
      attributes: ["id"],
    });

    if (exists) return false;
  }

  // ✅ EN SERIE, no en paralelo — evita deadlocks dentro de la misma tx
  await PointEvent.create(
    {
      user_id: userId,
      points,
      action_type: actionType,
      reference_id: referenceId,
      description,
    },
    { transaction },
  );

  await User.update(
    { total_points: sequelize.literal(`total_points + ${points}`) },
    { where: { id: userId }, transaction },
  );

  return true;
};

module.exports = { addPoints };
