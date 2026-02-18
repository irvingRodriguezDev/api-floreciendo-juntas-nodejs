const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Certification = sequelize.define(
  "Certification",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    certificate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    start_date: {
      type: DataTypes.DATE,
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    min_passing_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    max_passing_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "certifications",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = Certification;
