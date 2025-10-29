// models/Ticket.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Event = require("./Event");

const Ticket = sequelize.define("Ticket", {
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
  sold: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  scanned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  reserved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  reservation_expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
});

// Relación: un evento tiene muchos tickets
Event.hasMany(Ticket, { as: "tickets", foreignKey: "eventId" });
Ticket.belongsTo(Event, { foreignKey: "eventId" });

module.exports = Ticket;
