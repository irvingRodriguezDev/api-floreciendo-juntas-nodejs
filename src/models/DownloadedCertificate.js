const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DownloadedCertificate = sequelize.define(
  "DownloadedCertificate",
  {
    folio: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: "Folio único del certificado (ej: CERT-2024-000001)",
    },
    certification_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "certifications",
        key: "id",
      },
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users", // ajusta el nombre de tu tabla de usuarios
        key: "id",
      },
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Puntaje obtenido por el usuario",
    },
    issued_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Fecha de emisión del certificado",
    },
    download_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Número de veces que se ha descargado",
    },
    last_download_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Última vez que se descargó",
    },
  },
  {
    tableName: "downloaded_certificates",
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        unique: true,
        fields: ["certification_id", "user_id"],
        name: "unique_user_certification",
      },
    ],
  },
);

module.exports = DownloadedCertificate;
