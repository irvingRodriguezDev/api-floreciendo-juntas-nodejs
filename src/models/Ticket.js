// models/Ticket.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Event = require("./Event");

const Ticket = sequelize.define(
  "Ticket",
  {
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    buyerName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    buyerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    buyerPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    pdfUrl: {
      type: DataTypes.STRING,
      allowNull: true, // Puede generarse antes o hasta que se liquida
    },
    sold: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    scanned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    scannedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Estado de la venta del boleto
    paymentStatus: {
      type: DataTypes.ENUM(
        "AVAILABLE",
        "PENDING_PAYMENT",
        "PARTIALLY_PAID",
        "PAID",
      ),
      defaultValue: "AVAILABLE",
    },
  },
  {
    paranoid: true,
  },
);

Event.hasMany(Ticket, { as: "tickets", foreignKey: "eventId" });
Ticket.belongsTo(Event, { foreignKey: "eventId" });

module.exports = Ticket;
