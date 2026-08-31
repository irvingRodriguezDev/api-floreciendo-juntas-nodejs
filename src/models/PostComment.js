const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PostComment = sequelize.define(
  "Comment",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    postId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    // NULL = Comentario principal (raíz) | INT = Respuesta a otro comentario
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: {
        model: "comments",
        key: "id",
      },
    },
    // Opcional: ID del usuario al que se le responde dentro de un hilo (@Mención)
    replyToUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "deleted"),
      defaultValue: "active",
    },
  },
  {
    tableName: "comments",
    timestamps: true,
    indexes: [{ fields: ["postId"] }, { fields: ["parentId"] }],
  },
);

module.exports = PostComment;
