const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Course = sequelize.define(
  "Course",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    thumbnailUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    coverImage: {
      type: DataTypes.STRING,
      allowNull: true, // URL o S3
    },
    level: {
      type: DataTypes.ENUM("principiante", "intermedio", "avanzado"),
      allowNull: false,
      defaultValue: "principiante",
    },
    hasCertificate: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // 🆕 Nuevo campo
    system_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "systems",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
  {
    tableName: "courses",
    timestamps: true,
  }
);

Course.associate = (models) => {
  Course.belongsTo(models.System, {
    foreignKey: "system_id",
    as: "system",
  });

  Course.hasOne(models.CourseVideo, {
    foreignKey: "courseId",
    as: "video",
    onDelete: "CASCADE",
  });

  Course.hasMany(models.Review, {
    foreignKey: "courseId",
    as: "reviews",
    onDelete: "CASCADE",
  });

  Course.hasMany(models.CommunityPost, {
    foreignKey: "courseId",
    as: "posts",
    onDelete: "CASCADE",
  });

  Course.hasMany(models.CourseProgress, {
    foreignKey: "courseId",
    as: "progresses",
    onDelete: "CASCADE",
  });
};

module.exports = Course;
