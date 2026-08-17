const { Op } = require("sequelize");
const NotificationToken = require("../models/NotificationToken");

// Controlador de /save-notification-token
const saveNotificationToken = async (req, res) => {
  const { token, device, browserId } = req.body;
  const userId = req.user.id;

  try {
    if (!token) {
      return res.status(400).json({ error: "El token es requerido" });
    }

    // 1. Si el token pertenecía a OTRO usuario en esta máquina, lo eliminamos
    await NotificationToken.destroy({
      where: {
        token,
        userId: { [Op.ne]: userId },
      },
    });

    // 2. Si tenemos browserId, usamos la restricción compuesta (userId + browserId)
    if (browserId) {
      const [record, created] = await NotificationToken.findOrCreate({
        where: { userId, browserId },
        defaults: {
          userId,
          browserId,
          token,
          device: device || "web",
          isActive: true,
        },
      });

      // Si ya existía la combinación usuario + navegador, actualizamos el token
      if (!created) {
        await record.update({
          token,
          device: device || record.device || "web",
          isActive: true,
        });
      }
    } else {
      // Si no viene browserId, buscamos directamente por token
      await NotificationToken.upsert({
        userId,
        token,
        device: device || "web",
        isActive: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Token actualizado correctamente",
    });
  } catch (error) {
    console.error("❌ Error guardando NotificationToken:", error);
    return res.status(500).json({ error: "Error interno al guardar token" });
  }
};

module.exports = saveNotificationToken;
