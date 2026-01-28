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
    },

    token: {
      type: DataTypes.TEXT, // tokens FCM son largos
      allowNull: false,
      unique: true,
    },

    device: {
      type: DataTypes.STRING, // opcional (chrome, safari, mobile, etc.)
      allowNull: true,
    },
    browserId: {
      type: DataTypes.STRING,
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
    ],
  },
);

module.exports = NotificationToken;
