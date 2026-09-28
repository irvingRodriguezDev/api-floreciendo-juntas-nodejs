// models/Booking.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Ticket = require("./Ticket");

const Booking = sequelize.define(
  "Booking",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    folio: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true, // Ej: "RES-2026-8942"
    },
    buyerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    buyerEmail: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    buyerPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    totalAmount: {
      type: DataTypes.INTEGER, // En centavos
      allowNull: false,
    },
    paidAmount: {
      type: DataTypes.INTEGER, // En centavos
      defaultValue: 0,
    },
    pendingAmount: {
      type: DataTypes.INTEGER, // En centavos
      allowNull: false,
    },
    paymentType: {
      type: DataTypes.ENUM("FULL", "DEPOSIT"),
      allowNull: false,
      defaultValue: "FULL",
    },
    status: {
      type: DataTypes.ENUM(
        "PENDING",
        "PARTIAL",
        "COMPLETED",
        "CANCELLED",
        "EXPIRED",
      ),
      defaultValue: "PENDING",
    },
    // Agregamos métodos de pago y canal de reserva
    paymentMethod: {
      type: DataTypes.ENUM("STRIPE_CARD", "STRIPE_OXXO", "BANK_TRANSFER"),
      allowNull: false,
    },
    // Estado de aprobación (útil para transferencias que requieren validación en Admin)
    approvalStatus: {
      type: DataTypes.ENUM("APPROVED", "PENDING_REVIEW", "REJECTED"),
      defaultValue: "APPROVED", // Tarjeta u OXXO entran aprobados automáticamente al pagar
    },
    dueDate: {
      type: DataTypes.DATE, // Fecha límite para liquidar el saldo del 50%
      allowNull: true,
    },
    checkoutUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    paranoid: true,
  },
);

// Relaciones
Booking.hasMany(Ticket, { as: "tickets", foreignKey: "bookingId" });
Ticket.belongsTo(Booking, { foreignKey: "bookingId" });

module.exports = Booking;
