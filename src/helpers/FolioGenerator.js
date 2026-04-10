// utils/folioGenerator.js
const DownloadedCertificate = require("../models/DownloadedCertificate");
const { Op } = require("sequelize");
/**
 * Genera un folio único para el certificado
 * Formato: CERT-YYYY-NNNNNN
 */
async function generateFolio() {
  const year = new Date().getFullYear();

  // Obtener el último folio del año actual
  const lastCertificate = await DownloadedCertificate.findOne({
    where: {
      folio: {
        [Op.like]: `WAPI-${year}-%`,
      },
    },
    order: [["folio", "DESC"]],
  });

  let nextNumber = 1;

  if (lastCertificate) {
    // Extraer el número del folio anterior
    const lastNumber = parseInt(lastCertificate.folio.split("-")[2]);
    nextNumber = lastNumber + 1;
  }

  // Formato con 6 dígitos: CERT-2024-000001
  const folio = `WAPI-${year}-${nextNumber.toString().padStart(6, "0")}`;

  return folio;
}

module.exports = { generateFolio };
