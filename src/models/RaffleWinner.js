// models/RaffleWinner.js

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RaffleWinner = sequelize.define(
  "RaffleWinner",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    raffle_month: {
      type: DataTypes.STRING, // formato: "2025-02"
      allowNull: false,
    },

    position: {
      type: DataTypes.INTEGER,
      allowNull: false, // 1..10
      validate: {
        min: 1,
      },
    },

    prize_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "raffle_winners",
    timestamps: true,
  }
);

module.exports = RaffleWinner;
