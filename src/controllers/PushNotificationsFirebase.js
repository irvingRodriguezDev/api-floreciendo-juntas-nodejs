const NotificationToken = require("../models/NotificationToken");

// Controlador de /save-notification-token
const saveNotificationToken = async (req, res) => {
  const { token, device, browserId } = req.body;
  const userId = req.user.id;

  try {
    if (!token) {
      return res.status(400).json({ error: "El token es requerido" });
    }

    // 1. Si este mismo 'token' pertenecía a otro usuario en esta misma máquina,
    // lo desvinculamos o desactivamos para no enviar notificaciones cruzadas.
    await NotificationToken.update({ isActive: false }, { where: { token } });

    // 2. Si tenemos browserId, buscamos si ya existe el par (userId + browserId)
    let existingTokenRecord = null;
    if (browserId) {
      existingTokenRecord = await NotificationToken.findOne({
        where: { userId, browserId },
      });
    }

    // 3. Si no se encontró por (userId + browserId), buscamos directamente por token
    if (!existingTokenRecord) {
      existingTokenRecord = await NotificationToken.findOne({
        where: { token },
      });
    }

    // 4. Si ya existe el registro (sea por browserId o por token), lo ACTUALIZAMOS
    if (existingTokenRecord) {
      await existingTokenRecord.update({
        userId,
        token, // Actualiza el token si Firebase entregó uno nuevo
        device: device || existingTokenRecord.device || "web",
        browserId: browserId || existingTokenRecord.browserId,
        isActive: true,
      });
    } else {
      // 5. Si es un navegador/dispositivo totalmente nuevo, lo CREAMOS
      await NotificationToken.create({
        userId,
        token,
        device: device || "web",
        browserId: browserId || null,
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
