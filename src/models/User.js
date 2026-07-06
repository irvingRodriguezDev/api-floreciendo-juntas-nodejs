// src/models/User.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: false,
    },
    tiktokUsername: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: {
        name: "unique_phone_constraint",
        msg: "Este número ya está registrado",
      },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    session_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    roleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    profileImage: {
      type: DataTypes.STRING,
      allowNull: true, // Es opcional
    },
    stripe_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    total_points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    isSubscribed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false, // Por defecto, ningún usuario está suscrito
      allowNull: false,
    },
    stripeSubscriptionId: {
      type: DataTypes.STRING,
      allowNull: true, // Almacena el ID de la suscripción de Stripe (sub_...)
    },
  },
  {
    tableName: "Users",
  },
);

module.exports = User;
