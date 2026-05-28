const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Formations = sequelize.define(
  "Formations",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    diploma: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "formations",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = Formations;
