const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MonthlyPrize = sequelize.define(
  "MonthlyPrize",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    prize_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    raffle_month: {
      type: DataTypes.STRING, // formato "2025-02"
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("available", "awarded"),
      defaultValue: "available",
    },
  },
  {
    tableName: "monthly_prizes",
    timestamps: true,
  }
);

module.exports = MonthlyPrize;
