// models/Post.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Post = sequelize.define(
  "Post",
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
    title: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    visibility: {
      type: DataTypes.ENUM("public", "private"),
      defaultValue: "public",
    },
    status: {
      type: DataTypes.ENUM("active", "deleted"),
      defaultValue: "active",
    },
  },
  {
    tableName: "posts",
    timestamps: true,
  }
);

module.exports = Post;
