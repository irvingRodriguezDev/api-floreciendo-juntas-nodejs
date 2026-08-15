const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Ajusta la ruta a tu conexión

const Message = sequelize.define(
  "Message",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    conversationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "conversations",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    receiverId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Estado de lectura
    read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Tipo de mensaje opcional (ej: 'BIRTHDAY_WISH', 'TEXT') por si quieres estilizarlo especial en el chat
    type: {
      type: DataTypes.ENUM(
        "TEXT",
        "BIRTHDAY_WISH",
        "DIRECT_MESSAGE",
        "REPLY_STORY",
        "REACTION_STORY"
      ),
      defaultValue: "TEXT",
    },
  },
  {
    tableName: "messages",
    timestamps: true,
    indexes: [
      {
        fields: ["conversationId"],
      },
      {
        fields: ["receiverId", "read"], // Agiliza el conteo de mensajes no leídos (badge de notificación)
      },
    ],
  }
);

module.exports = Message;
