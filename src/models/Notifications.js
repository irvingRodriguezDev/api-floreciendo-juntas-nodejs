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

    // Usuario que recibe la notificación
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // Usuario que genera la acción
    actorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // Tipo lógico (post, comment, like, course, event, live, etc.)
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // ID de la entidad relacionada (postId, courseId, etc.)
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // Metadata adicional (commentId, reactionType, etc.)
    data: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    title: {
      type: DataTypes.STRING,
    },

    body: {
      type: DataTypes.STRING,
    },

    url: {
      type: DataTypes.STRING,
    },

    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "notifications",
    indexes: [
      { fields: ["userId"] },
      { fields: ["type"] },
      { fields: ["readAt"] },
      { fields: ["createdAt"] },
    ],
  },
);
module.exports = Notifications;
