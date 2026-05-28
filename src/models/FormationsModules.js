const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const FormationsModules = sequelize.define(
  "FormationsModules",
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    formationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "formations_modules",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = FormationsModules;
