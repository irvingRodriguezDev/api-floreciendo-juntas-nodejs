const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const NotificationToken = sequelize.define(
  "NotificationToken",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" }, // Mejora la integridad referencial
    },
    token: {
      type: DataTypes.STRING(512), // Suficiente para FCM y permite indexación rápida
      allowNull: false,
      unique: true,
    },
    device: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    browserId: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "notification_tokens",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["user_id", "browser_id"],
      },
      {
        // 🚀 CRÍTICO: Para el WHERE { token: [array] } del Multicast
        fields: ["token"],
      },
      {
        // 🚀 CRÍTICO: Para el SELECT de usuarios suscritos
        fields: ["user_id", "is_active"],
      },
    ],
  },
);

module.exports = NotificationToken;
