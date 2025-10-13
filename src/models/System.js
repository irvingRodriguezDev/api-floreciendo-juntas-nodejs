const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const System = sequelize.define(
  "System",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    icon: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
  },
  {
    tableName: "systems",
    timestamps: true, // puedes poner true si quieres createdAt/updatedAt
  }
);

module.exports = System;
