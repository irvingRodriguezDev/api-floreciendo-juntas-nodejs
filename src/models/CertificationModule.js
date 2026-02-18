const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const CertificationModule = sequelize.define(
  "CertificationModule",
  {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    certificationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "certification_modules",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = CertificationModule;
