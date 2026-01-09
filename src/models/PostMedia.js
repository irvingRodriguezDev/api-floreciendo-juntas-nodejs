// models/PostMedia.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const PostMedia = sequelize.define(
  "PostMedia",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    modelType: {
      type: DataTypes.ENUM("post", "comment"),
      allowNull: false,
    },
    modelId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("image", "video"),
      allowNull: false,
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "post_media",
    timestamps: true,
  }
);

module.exports = PostMedia;
