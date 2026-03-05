const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Notifications = sequelize.define(
  "Notifications",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    actorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    type: {
      // Usar STRING con límite ayuda a la velocidad de indexación
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING(150), // Definir longitud ahorra espacio en disco
    },
    body: {
      type: DataTypes.STRING(255),
    },
    url: {
      type: DataTypes.STRING(255),
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "notifications",
    underscored: true, // Recomendado para mantener consistencia (user_id en lugar de userId en SQL)
    indexes: [
      // 🚀 EL MÁS IMPORTANTE: Para cargar el historial del usuario rápido y ordenado
      {
        name: "idx_user_created",
        fields: ["userId", "createdAt"],
      },
      // 🚀 PARA FILTRAR NO LEÍDAS: Evita que MySQL escanee toda la tabla
      {
        name: "idx_user_unread",
        fields: ["userId", "readAt"],
      },
      // Índice para limpiezas masivas (Cron jobs)
      { fields: ["created_at"] },
    ],
  },
);

module.exports = Notifications;
