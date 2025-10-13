// models/CommunityPost.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CommunityPost = sequelize.define(
  "CommunityPost",
  {
    courseId: {
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
      type: DataTypes.JSON, // puedes guardar URLs de imágenes o archivos S3
      allowNull: true,
    },
  },
  {
    tableName: "community_posts",
    timestamps: true,
  }
);

// 🔗 Asociaciones
CommunityPost.associate = (models) => {
  CommunityPost.belongsTo(models.User, {
    foreignKey: "userId",
    as: "author",
    onDelete: "CASCADE",
  });

  CommunityPost.hasMany(models.CommunityComent, {
    foreignKey: "postId",
    as: "comments",
    onDelete: "CASCADE",
  });

  CommunityPost.hasMany(models.CommunityReaction, {
    foreignKey: "postId",
    as: "reactions",
    onDelete: "CASCADE",
  });
};

module.exports = CommunityPost;
