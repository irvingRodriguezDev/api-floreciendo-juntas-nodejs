const fs = require("fs");
const path = require("path");
const { Sequelize } = require("sequelize");

// Resuelve el path desde env o fallback local
const caPath = process.env.DB_SSL_CA
  ? path.resolve(process.env.DB_SSL_CA)
  : path.join(__dirname, "../../certs/global-bundle.pem");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: 3306,
    dialect: "mysql",
    logging: false,
    timezone: "-06:00",

    // dialectOptions: {
    //   ssl: {
    //     require: true,
    //     rejectUnauthorized: false,
    //     ca: fs.readFileSync(caPath),
    //   },
    // },
    // 🛡️ Protecciones contra desconexiones (Retry)
    retry: {
      match: [/read ECONNRESET/, /ETIMEDOUT/, /EADDRNOTAVAIL/, /ECONNREFUSED/],
      max: 3, // Si la red parpadea un segundo, Sequelize lo intenta de nuevo solo
    },

    pool: {
      max: 50, // Más capacidad para picos de tráfico
      min: 10, // Conexiones siempre listas
      acquire: 60000, // Se queda igual (1 minuto)
      idle: 10000,
    },
  },
);

module.exports = sequelize;
