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

    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
        ca: fs.readFileSync(caPath),
      },
    },

    pool: {
      max: 20,
      min: 3,
      acquire: 60000,
      idle: 10000,
    },
  },
);

module.exports = sequelize;
