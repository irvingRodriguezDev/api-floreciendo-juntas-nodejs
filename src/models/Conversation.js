const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Ajusta la ruta a tu conexión

const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // ID de la usuaria que inició la conversación
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    // ID de la usuaria receptora
    receiverId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    // Guardamos el último mensaje para mostrar en el preview de la bandeja
    lastMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Fecha/hora del último mensaje para ordenar la bandeja (del más reciente al más antiguo)
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "conversations",
    timestamps: true,
    indexes: [
      // Índice compuesto para acelerar la búsqueda de conversaciones entre 2 usuarias
      {
        unique: true,
        fields: ["senderId", "receiverId"],
      },
    ],
  },
);

module.exports = Conversation;
