const admin = require("../config/firebase");

const sendPushNotification = async ({ token, title, body, data = {} }) => {
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
      // TODO: marcar isActive=false en DB
    }

    console.error("❌ sendPushNotification:", error);
    return { success: false, error: error.code };
  }
};

module.exports = sendPushNotification;
