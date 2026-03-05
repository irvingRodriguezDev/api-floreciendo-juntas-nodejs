const admin = require("../config/firebase");
const { NotificationToken } = require("../models");

/**
 * ENVÍO INDIVIDUAL (Mantener para compatibilidad si se usa en otros lados)
 */
const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!token) return { success: false };
  try {
    const message = {
      token,
      data: {
        title: String(title || ""),
        body: String(body || ""),
        url: String(data.url || "/"),
      },
      webpush: { fcmOptions: { link: data.url || "/" } },
    };
    await admin.messaging().send(message);
    return { success: true };
  } catch (error) {
    await handleFcmError(error, [token]);
    return { success: false };
  }
};

/**
 * ENVÍO MASIVO (MULTICAST) 🚀
 * Ideal para notificar a cientos de personas sin saturar la red.
 */
const sendPushNotificationMulticast = async ({
  tokens,
  title,
  body,
  data = {},
}) => {
  if (!tokens || tokens.length === 0) return { success: true };

  const message = {
    tokens, // Array de tokens
    data: {
      title: String(title || ""),
      body: String(body || ""),
      url: String(data.url || "/"),
    },
    webpush: {
      fcmOptions: {
        link: data.url || "/",
      },
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);

    // Si hubo fallos, procesamos cuáles tokens ya no sirven
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error.code;
          if (
            errorCode === "messaging/registration-token-not-registered" ||
            errorCode === "messaging/invalid-registration-token"
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        // Desactivación masiva para no saturar la BD con 900 updates individuales
        await NotificationToken.update(
          { isActive: false },
          { where: { token: invalidTokens } },
        );
        console.warn(
          `🧹 Limpieza: ${invalidTokens.length} tokens desactivados.`,
        );
      }
    }

    return { success: true, failureCount: response.failureCount };
  } catch (error) {
    console.error("❌ Error en sendPushNotificationMulticast:", error);
    return { success: false, error: error.message };
  }
};

// Helper interno para manejar errores de token
const handleFcmError = async (error, tokens) => {
  if (
    error.code === "messaging/registration-token-not-registered" ||
    error.code === "messaging/invalid-registration-token"
  ) {
    await NotificationToken.update(
      { isActive: false },
      { where: { token: tokens } },
    );
  }
};

module.exports = {
  sendPushNotification,
  sendPushNotificationMulticast,
};
