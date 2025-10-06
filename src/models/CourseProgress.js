// models/CourseProgress.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CourseProgress = sequelize.define(
  "CourseProgress",
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
    courseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    lastWatchedSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "course_progress",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["userId", "courseId"],
      },
    ],
  }
);

// 🔗 Asociaciones
CourseProgress.associate = (models) => {
  CourseProgress.belongsTo(models.User, {
    foreignKey: "userId",
    as: "user",
    onDelete: "CASCADE",
  });

  CourseProgress.belongsTo(models.Course, {
    foreignKey: "courseId",
    as: "course",
    onDelete: "CASCADE",
  });
};

module.exports = CourseProgress;
