const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const ModuleCriterion = sequelize.define(
  "ModuleCriterion",
  {
    moduleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    max_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
  },
  {
    tableName: "module_criteria",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = ModuleCriterion;
