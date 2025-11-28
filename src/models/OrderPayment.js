const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const OrderPayment = sequelize.define(
  "OrderPayment",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    orderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "orders",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    paymentDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    paymentMethod: {
      type: DataTypes.ENUM("efectivo", "tarjeta", "transferencia", "paypal"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("completado", "rechazado"),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("initial", "partial", "shipping"),
      allowNull: false,
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: "Referencia de pago o comprobante",
    },
  },
  {
    tableName: "order_payments",
    timestamps: true,
  }
);

module.exports = OrderPayment;
