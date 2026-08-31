const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PostCommentLike = sequelize.define(
  "PostCommentLike",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "post_comment_likes",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["commentId", "userId"],
      },
    ],
  },
);

module.exports = PostCommentLike;
