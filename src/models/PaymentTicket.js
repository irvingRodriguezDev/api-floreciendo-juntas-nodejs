// models/PaymentTicket.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Booking = require("./Booking");

const PaymentTicket = sequelize.define(
  "PaymentTicket",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    amount: {
      type: DataTypes.INTEGER, // En centavos
      allowNull: false,
    },
    paymentMethod: {
      type: DataTypes.ENUM(
        "STRIPE_CARD",
        "STRIPE_OXXO",
        "BANK_TRANSFER",
        "CASH",
      ),
      allowNull: false,
    },
    transactionRef: {
      type: DataTypes.STRING, // ID de Stripe Session, Intent o Folio Bancario
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED", "REFUNDED"),
      defaultValue: "PENDING",
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notes: {
      type: DataTypes.STRING, // Ej: "Monto de apartado (60%)" o "Liquidación final"
      allowNull: true,
    },
    proofOfPaymentUrl: {
      type: DataTypes.STRING, // URL de la foto/PDF del comprobante cuando es Transferencia
      allowNull: true,
    },
  },
  {
    paranoid: true,
  },
);

// Relaciones
Booking.hasMany(PaymentTicket, {
  as: "paymentsHistory",
  foreignKey: "bookingId",
});
PaymentTicket.belongsTo(Booking, { foreignKey: "bookingId" });

module.exports = PaymentTicket;
