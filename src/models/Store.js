const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Tu configuración de conexión

const Store = sequelize.define(
  "Store",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "Dirección legible para el usuario",
    },
    // Coordenadas con precisión de 8 decimales (estándar de Google Maps)
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: false,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "Número para el botón de WhatsApp",
    },
    imageUrl: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "URL de la foto del local en S3",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    userId: {
      type: DataTypes.INTEGER, // Ajusta según el tipo de dato de tu tabla Users
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
  },
  {
    timestamps: true,
    tableName: "stores",
    paranoid: true,
  },
);

module.exports = Store;
