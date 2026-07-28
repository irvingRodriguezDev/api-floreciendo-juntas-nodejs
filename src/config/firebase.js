const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const serviceAccount = require("../../floreciendo-juntas-web-firebase-adminsdk-fbsvc-2e7f11036a.json");

// 1. Inicializar la App de Firebase
const app = initializeApp({
  credential: cert(serviceAccount),
});

// 2. Obtener la instancia de Messaging (FCM)
const messaging = getMessaging(app);

module.exports = {
  app,
  messaging,
};
