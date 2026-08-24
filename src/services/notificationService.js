const { Op } = require("sequelize");
// Importa tus modelos y utilidades según la estructura de tu proyecto
const { Notifications, NotificationToken } = require("../models");
const { sendPushNotificationMulticast } = require("./sendPushNotification");
const emitNotification = require("../helpers/emitNotification");
/**
 * Helper centralizado para notificaciones (BD + Socket + Push FCM)
 * @param {Object} params
 * @param {number|number[]} params.recipientIds - ID o Array de IDs de usuarios destino
 * @param {number} params.actorId - Creador de la acción (quien genera la notif)
 * @param {string} params.type - Tipo de notificación ('comment', 'comment_thread', etc.)
 * @param {number|string} params.entityId - ID de la entidad relacionada
 * @param {string} params.title - Título de la notificación
 * @param {string} params.body - Mensaje / Cuerpo
 * @param {string} params.url - Ruta para redirección en frontend
 * @param {Object} [params.extraData={}] - Payload extra para FCM o BD
 */
const sendNotificationToUsers = async ({
  recipientIds,
  actorId,
  type,
  entityId,
  title,
  body,
  url,
  extraData = {},
}) => {
  try {
    // Normalizamos recipientIds a un array
    const targetIds = Array.isArray(recipientIds)
      ? recipientIds
      : [recipientIds];

    // Filtrar para evitar que el actor se notifique a sí mismo por error
    const validTargetIds = targetIds.filter((id) => id !== actorId);
    if (validTargetIds.length === 0) return;

    // 1. Guardar en Base de Datos (bulkCreate maneja de 1 a N registros)
    const notificationsToCreate = validTargetIds.map((userId) => ({
      userId,
      actorId,
      type,
      entityId,
      title,
      body,
      url,
      data: extraData,
    }));

    const createdNotifications = await Notifications.bulkCreate(
      notificationsToCreate,
      { returning: true }
    );

    // 2. Emitir evento por Sockets en tiempo real
    createdNotifications.forEach((notif) => {
      emitNotification(notif.userId, notif);
    });

    // 3. Buscar tokens FCM activos de todos los destinatarios
    const activeTokens = await NotificationToken.findAll({
      where: {
        userId: { [Op.in]: validTargetIds },
        isActive: true,
      },
      attributes: ["token"],
    });

    const tokensList = activeTokens.map((t) => t.token);

    // 4. Enviar Push Multicast por FCM en lotes de 500
    if (tokensList.length > 0) {
      const payloadData = {
        type,
        url,
        ...Object.keys(extraData).reduce((acc, key) => {
          acc[key] = String(extraData[key]); // FCM requiere que todo en data sea String
          return acc;
        }, {}),
      };

      for (let i = 0; i < tokensList.length; i += 500) {
        const batch = tokensList.slice(i, i + 500);
        await sendPushNotificationMulticast({
          tokens: batch,
          title,
          body,
          data: payloadData,
        }).catch((err) =>
          console.error("⚠️ Error FCM Multicast en batch:", err)
        );
      }
    }
  } catch (error) {
    console.error("❌ Error en sendNotificationToUsers:", error);
  }
};

module.exports = {
  sendNotificationToUsers,
};
