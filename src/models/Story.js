const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Ajusta la ruta a tu conexión

const Story = sequelize.define(
  "Story",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    mediaUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    caption: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("image", "video"),
      allowNull: false,
      defaultValue: "image",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // Expiración en +24 horas
    },
  },
  {
    tableName: "stories",
    timestamps: true,
    indexes: [
      {
        fields: ["expiresAt"], // Indexado para filtrar rápido las historias no expiradas
      },
      {
        fields: ["userId"], // Indexado para agrupar historias por usuario
      },
    ],
  },
);

module.exports = Story;
