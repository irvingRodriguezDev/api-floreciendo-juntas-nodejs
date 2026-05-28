const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const DeliveryFormations = sequelize.define(
  "DeliveryFormations",
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    moduleFormationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    urlDelivery: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("submitted", "accepted", "rejected"),
      defaultValue: "submitted",
      allowNull: false,
    },
    accepted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    submitDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    acceptedDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "delivery_formations",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = DeliveryFormations;
