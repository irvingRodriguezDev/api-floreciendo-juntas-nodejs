const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Event = sequelize.define("Event", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  location: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  map: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  time: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  image: {
    type: DataTypes.STRING,
  },
  totalTickets: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 50,
  },
  price: {
    type: DataTypes.INTEGER,
    allowNull: false,
    set(value) {
      // Si el usuario manda 150.50 pesos, se guarda 15050 centavos
      this.setDataValue("price", Math.round(parseFloat(value) * 100));
    },
    get() {
      // Para leer en pesos fácilmente
      const rawValue = this.getDataValue("price");
      return rawValue / 100;
    },
  },
});

module.exports = Event;
