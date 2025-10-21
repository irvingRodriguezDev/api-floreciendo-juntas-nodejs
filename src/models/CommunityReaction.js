const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CommunityReaction = sequelize.define(
  "CommunityReaction",
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
    postId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    commentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM(
        "Me Gusta",
        "Me encanta",
        "Me divierte",
        "Me sorprende",
        "Me entristese",
        "Me enoja"
      ),
      allowNull: false,
    },
  },
  {
    tableName: "community_reactions",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["postId"] },
      { fields: ["commentId"] },
      { unique: true, fields: ["userId", "postId", "type"] },
      { unique: true, fields: ["userId", "commentId", "type"] },
    ],
    validate: {
      // Solo debe tener un objetivo: postId o commentId, no ambos
      eitherTarget() {
        if (!this.postId && !this.commentId) {
          throw new Error("Debe existir postId o commentId");
        }
        if (this.postId && this.commentId) {
          throw new Error("Solo puede tener un objetivo: post o comentario");
        }
      },
    },
  }
);

CommunityReaction.associate = (models) => {
  CommunityReaction.belongsTo(models.User, {
    foreignKey: "userId",
    as: "user",
    onDelete: "CASCADE",
  });

  CommunityReaction.belongsTo(models.CommunityPost, {
    foreignKey: "postId",
    as: "post",
    onDelete: "CASCADE",
  });

  CommunityReaction.belongsTo(models.CommunityComment, {
    foreignKey: "commentId",
    as: "comment",
    onDelete: "CASCADE",
  });
};

module.exports = CommunityReaction;
