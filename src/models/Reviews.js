// models/Review.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Review = sequelize.define(
  "Review",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    courseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5,
      },
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "reviews",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["courseId", "userId"], // Un usuario solo puede dejar 1 review por curso
      },
    ],
  }
);

// 🔗 Asociaciones
Review.associate = (models) => {
  Review.belongsTo(models.User, {
    foreignKey: "userId",
    as: "user",
    onDelete: "CASCADE",
  });

  Review.belongsTo(models.Course, {
    foreignKey: "courseId",
    as: "course",
    onDelete: "CASCADE",
  });
};

module.exports = Review;
