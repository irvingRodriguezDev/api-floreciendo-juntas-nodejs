const admin = require("firebase-admin");

const serviceAccount = require("../../floreciendo-juntas-web-firebase-adminsdk-fbsvc-77e158c00d.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
