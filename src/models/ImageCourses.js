const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ImageCourses = sequelize.define(
  "ImageCourses",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    courseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    s3_key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "course_images",
    timestamps: true,
    underscored: true,
  }
);
ImageCourses.associate = (models) => {
  ImageCourses.belongsTo(models.Course, {
    foreignKey: "courseId",
    as: "course",
    onDelete: "CASCADE",
  });
};
module.exports = ImageCourses;
