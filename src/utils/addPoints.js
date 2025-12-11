import PointEvent from "../models/PointEvent.js";
import User from "../models/User.js";

export const addPoints = async (
  userId,
  points,
  actionType,
  referenceId = null,
  description = null
) => {
  // 1. Opcional: evitar duplicados cuando reference_id es único
  if (referenceId) {
    const exists = await PointEvent.findOne({
      where: {
        user_id: userId,
        action_type: actionType,
        reference_id: referenceId,
      },
    });

    if (exists) return; // ya otorgaste estos puntos
  }

  // 2. Crear evento
  await PointEvent.create({
    user_id: userId,
    points,
    action_type: actionType,
    reference_id: referenceId,
    description,
  });

  // 3. Actualizar total en users
  await User.increment("total_points", {
    by: points,
    where: { id: userId },
  });

  return true;
};
