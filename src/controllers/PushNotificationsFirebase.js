const NotificationToken = require("../models/NotificationToken");

// Controlador de /save-notification-token
const saveNotificationToken = async (req, res) => {
  const { token, device, browserId } = req.body;
  const userId = req.user.id; // ID del usuario autenticado vía JWT/Sesión

  try {
    if (!token) {
      return res.status(400).json({ error: "El token es requerido" });
    }

    // 1. Desactivar este mismo token si estaba registrado previamente
    //    (por ejemplo, si pertenecía a otro usuario que usó el mismo teléfono)
    await NotificationToken.update({ isActive: false }, { where: { token } });

    // 2. Si se envía browserId, desactivar tokens viejos del mismo usuario en este navegador
    if (browserId) {
      await NotificationToken.update(
        { isActive: false },
        { where: { userId, browserId } },
      );
    }

    // 3. Crear o Reactivar el nuevo token para el usuario actual
    const [notificationToken, created] = await NotificationToken.findOrCreate({
      where: { token },
      defaults: {
        userId,
        device: device || "web",
        browserId: browserId || null,
        isActive: true,
      },
    });

    // Si ya existía el registro del token, lo actualizamos y activamos para el usuario actual
    if (!created) {
      await notificationToken.update({
        userId,
        device: device || notificationToken.device,
        browserId: browserId || notificationToken.browserId,
        isActive: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Token de notificación actualizado correctamente",
    });
  } catch (error) {
    console.error("❌ Error guardando NotificationToken:", error);
    return res.status(500).json({ error: "Error al guardar token" });
  }
};

module.exports = saveNotificationToken;
