// models/PostLike.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PostLike = sequelize.define(
  "PostLike",
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
  },
  {
    tableName: "post_likes",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["postId", "userId"],
      },
    ],
  }
);

module.exports = PostLike;
