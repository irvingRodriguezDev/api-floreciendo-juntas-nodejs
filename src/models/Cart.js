const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Cart = sequelize.define(
  "Cart",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER, // 👈 mismo tipo que User.id
      allowNull: false,
      references: {
        model: "Users", // 👈 nombre exacto de la tabla (en minúscula)
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    status: {
      type: DataTypes.ENUM("apartado", "pagando", "completado", "abandonado"),
      allowNull: false,
      defaultValue: "apartado",
    },
  },
  {
    tableName: "carts",
    timestamps: true,
  }
);

module.exports = Cart;
