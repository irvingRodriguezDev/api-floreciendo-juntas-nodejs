const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const EvaluationScore = sequelize.define(
  "EvaluationScore",
  {
    evaluationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    criterionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5, // 🔥 importante
      },
    },
  },
  {
    tableName: "evaluation_scores",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["evaluationId", "criterionId"],
      },
    ],
  },
);

module.exports = EvaluationScore;
