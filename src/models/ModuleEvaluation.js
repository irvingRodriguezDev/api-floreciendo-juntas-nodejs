const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const ModuleEvaluation = sequelize.define(
  "ModuleEvaluation",
  {
    submissionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // 🔥 solo una evaluación por entrega
    },

    teacherId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    total_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    general_feedback: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    evaluated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "module_evaluations",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = ModuleEvaluation;
