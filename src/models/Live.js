// src/models/Live.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Live = sequelize.define(
  "Live",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    thumbnail_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    start_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    end_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("scheduled", "live", "ended", "cancelled"),
      defaultValue: "scheduled",
    },

    aws_playback_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    aws_stream_key: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    aws_channel_arn: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    aws_ingest_endpoint: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    aws_stream_key_arn: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    stream_started_at: {
      type: DataTypes.DATE,
    },
    stream_ended_at: {
      type: DataTypes.DATE,
    },
    current_stream_id: {
      type: DataTypes.STRING,
    },
    // Todos los lives de Floreciendo Juntas son privados para suscriptoras
    is_private: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    paranoid: true,
    tableName: "Lives",
  }
);

module.exports = Live;
