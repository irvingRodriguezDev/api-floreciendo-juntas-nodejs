const admin = require("firebase-admin");

const serviceAccount = require("../../floreciendo-juntas-web-firebase-adminsdk-fbsvc-2e7f11036a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
