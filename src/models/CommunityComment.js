// models/CommunityComment.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CommunityComment = sequelize.define(
  "CommunityComment",
  {
    postId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSON, // puedes guardar URLs de imágenes o archivos subidos a S3
      allowNull: true,
    },
  },
  {
    tableName: "community_comments",
    timestamps: true,
  }
);

// 🔗 Asociaciones
CommunityComment.associate = (models) => {
  CommunityComment.belongsTo(models.User, {
    foreignKey: "userId",
    as: "user",
    onDelete: "CASCADE",
  });

  CommunityComment.belongsTo(models.CommunityPost, {
    foreignKey: "postId",
    as: "post",
    onDelete: "CASCADE",
  });

  CommunityComment.hasMany(models.CommunityReaction, {
    foreignKey: "commentId",
    as: "reactions",
    onDelete: "CASCADE",
  });
};

module.exports = CommunityComment;
