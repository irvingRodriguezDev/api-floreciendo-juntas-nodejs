// services/resendService.js
const { Resend } = require("resend");
const resendKey = process.env.RESEND_API_KEY; // Reemplaza con tu clave de API de Resend
const resend = new Resend(resendKey);

const templateA = require("../templates/templateA_Full");
const templateB = require("../templates/templateB_Deposit");
const templateC = require("../templates/templateC_Liquid");

const sendBookingEmail = async ({ type, bookingData }) => {
  const clientUrl = process.env.CLIENT_URL || "https://tudominio.com";
  let htmlContent = "";
  let subject = "";

  switch (type) {
    case 1:
    case "FULL_PURCHASE":
      subject = `🎟️ ¡Tus accesos están listos! — Folio: ${bookingData.folio}`;
      htmlContent = templateA({ ...bookingData, clientUrl });
      break;

    case 2:
    case "DEPOSIT_RESERVATION":
      subject = `📋 Reserva Confirmada (60%) — Folio: ${bookingData.folio}`;
      htmlContent = templateB({ ...bookingData, clientUrl });
      break;

    case 3:
    case "LIQUIDATION_COMPLETE":
      subject = `🎉 ¡Liquidación Exitosa! Tus accesos digitales — Folio: ${bookingData.folio}`;
      htmlContent = templateC({ ...bookingData, clientUrl });
      break;

    default:
      throw new Error(`Tipo de correo no válido: ${type}`);
  }

  return await resend.emails.send({
    from: "Eventos Wapizima <tusboletos@eventoswapizima.com>",
    to: [bookingData.email],
    subject: subject,
    html: htmlContent,
  });
};

module.exports = { sendBookingEmail };
