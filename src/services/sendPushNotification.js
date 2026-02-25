const admin = require("../config/firebase");
const { NotificationToken } = require("../models");

const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!token) return { success: false, skipped: true };

  const message = {
    token,
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
    const response = await admin.messaging().send(message);
    return { success: true, response };
  } catch (error) {
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      console.warn(`⚠️ Token inválido: ${token}`);

      // 🔥 DESACTIVAR TOKEN PARA NO VOLVER A INTENTAR
      await NotificationToken.update({ isActive: false }, { where: { token } });

      return { success: false, error: "TOKEN_DISABLED" };
    }

    console.error("❌ sendPushNotification:", error);
    return { success: false, error: error.code };
  }
};

module.exports = sendPushNotification;
