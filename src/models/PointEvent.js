const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const PointEvent = sequelize.define(
  "PointEvent",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 },
    },

    action_type: {
      type: DataTypes.ENUM(
        "course_completed",
        "course_progress",
        "post_created",
        "comment_created",
        "reaction",
        "login_streak",
        "custom",
      ),
      allowNull: false,
    },

    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    tableName: "point_events",
    timestamps: true,
    underscored: true,
  },
);

module.exports = PointEvent;
