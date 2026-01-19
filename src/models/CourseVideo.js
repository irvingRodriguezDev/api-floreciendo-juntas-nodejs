// models/CourseVideo.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CourseVideo = sequelize.define(
  "CourseVideo",
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
    s3Key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    durationSeconds: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    sizeBytes: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    upload_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("subiendo", "procesando", "listo", "error"),
      allowNull: false,
      defaultValue: "subiendo",
    },
    cloudfrontUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "course_videos",
    timestamps: true,
  }
);

// 🔗 Asociaciones
CourseVideo.associate = (models) => {
  CourseVideo.belongsTo(models.Course, {
    foreignKey: "courseId",
    as: "course",
  });
};

module.exports = CourseVideo;
