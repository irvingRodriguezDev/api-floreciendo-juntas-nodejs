const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const certificateCourse = sequelize.define(
  "certificateCourse",
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
    s3_key_certificate: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "course_certificates",
    timestamps: true,
    underscored: true,
  }
);
certificateCourse.associate = (models) => {
  certificateCourse.belongsTo(models.Course, {
    foreignKey: "courseId",
    as: "course",
    onDelete: "CASCADE",
  });
};
module.exports = certificateCourse;
