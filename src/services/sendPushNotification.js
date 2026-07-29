// 1. Desestructura 'messaging' de tu archivo de configuración
const { messaging } = require("../config/firebase");
const { NotificationToken } = require("../models");

/**
 * ENVÍO INDIVIDUAL
 */
const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!token) return { success: false };
  try {
    const url = data.url || "/";
    const message = {
      token,
      // 1. Notificación estándar para Android/APNs nativo
      notification: {
        title: String(title || ""),
        body: String(body || ""),
      },
      // 2. Data opcional para manejo personalizado en frontend
      data: {
        title: String(title || ""),
        body: String(body || ""),
        url: String(url),
      },
      // 3. Estructura WebPush OBLIGATORIA para iOS Safari PWA
      webpush: {
        notification: {
          title: String(title || ""),
          body: String(body || ""),
          icon: "/logo192.png", // Icono de tu PWA
          badge: "/badge.png", // Icono para la barra
        },
        fcmOptions: {
          link: url,
        },
      },
    };

    // 💡 CAMBIO AQUÍ: Se usa directamente 'messaging.send', sin paréntesis
    await messaging.send(message);
    return { success: true };
  } catch (error) {
    await handleFcmError(error, [token]);
    return { success: false };
  }
};

/**
 * ENVÍO MASIVO (MULTICAST) 🚀
 */
const sendPushNotificationMulticast = async ({
  tokens,
  title,
  body,
  data = {},
}) => {
  if (!tokens || tokens.length === 0) return { success: true };

  const url = data.url || "/";
  const message = {
    tokens, // Array de tokens
    // 1. Notificación estándar
    notification: {
      title: String(title || ""),
      body: String(body || ""),
    },
    // 2. Payload de datos
    data: {
      title: String(title || ""),
      body: String(body || ""),
      url: String(url),
    },
    // 3. Estructura WebPush OBLIGATORIA para iOS Safari PWA
    webpush: {
      notification: {
        title: String(title || ""),
        body: String(body || ""),
        icon: `${process.env.CLIENT_URL}/foto.png`,
        badge: `${process.env.CLIENT_URL}/foto.png`,
      },
      fcmOptions: {
        link: url,
      },
    },
  };

  try {
    // 💡 CAMBIO AQUÍ: Se usa directamente 'messaging.sendEachForMulticast'
    const response = await messaging.sendEachForMulticast(message);

    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === "messaging/registration-token-not-registered" ||
            errorCode === "messaging/invalid-registration-token"
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
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
