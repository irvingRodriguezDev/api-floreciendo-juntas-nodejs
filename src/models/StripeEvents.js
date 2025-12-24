const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StripeEvent = sequelize.define(
  "StripeEvent",
  {
    event_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    processed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "stripe_events",
    timestamps: false,
  }
);

module.exports = StripeEvent;
