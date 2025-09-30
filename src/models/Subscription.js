// src/models/Subscription.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // tu instancia de Sequelize
const User = require("./User"); // importamos User

const Subscription = sequelize.define(
  "Subscription",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    stripe_subscription_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    subscription_type: {
      type: DataTypes.ENUM("payment", "subscription"),
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_renewal: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "canceled", "expired"),
      defaultValue: "active",
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "Subscriptions",
  }
);

// Relaciones
Subscription.belongsTo(User, { foreignKey: "userId", onDelete: "CASCADE" });
User.hasMany(Subscription, { foreignKey: "userId" });

module.exports = Subscription;
