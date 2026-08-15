const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Ajusta la ruta a tu conexión

const StoryView = sequelize.define(
  "StoryView",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    storyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "stories",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    viewerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
  },
  {
    tableName: "story_views",
    timestamps: true,
    updatedAt: false, // Solo registra cuándo fue vista
    indexes: [
      {
        unique: true,
        fields: ["storyId", "viewerId"], // Evita registrar vistas duplicadas de la misma historia por el mismo usuario
      },
    ],
  }
);

module.exports = StoryView;
