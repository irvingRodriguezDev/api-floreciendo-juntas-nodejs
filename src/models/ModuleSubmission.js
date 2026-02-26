const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const ModuleSubmission = sequelize.define(
  "ModuleSubmission",
  {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    moduleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    photo_1: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    photo_2: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    photo_3: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM("submitted", "reviewed"),
      defaultValue: "submitted",
    },
  },
  {
    tableName: "module_submissions",
    timestamps: true,
    paranoid: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["moduleId"] },
      { fields: ["status"] }, // Crítico para filtrar los que faltan por revisar
    ],
  },
);

module.exports = ModuleSubmission;
