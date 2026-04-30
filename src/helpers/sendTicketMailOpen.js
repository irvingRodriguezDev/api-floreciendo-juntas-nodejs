const {
  generateCalendarLinks,
  saveICSToS3,
  generateCalendarButtonsHTML,
} = require("./generateCalendarLinks");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");
const nodemailer = require("nodemailer");

// El sender debe ser tu correo validado en SendGrid
const sender = process.env.SENGRID_FROM;

/**
 * 📧 Envía el ticket por email con enlaces directos a cada boleto (Open Flow)
 */
const sendTicketMailOpen = async (tickets, event, user) => {
  try {
    // 1. Datos del resumen
    const quantity = tickets.length;
    const unitPrice = event?.price ?? 0;
    const total = unitPrice * quantity;

    // 2. Calendario y S3 (Mantenemos tu lógica original)
    const calendarLinks = generateCalendarLinks(event);
    const icsS3Key = await saveICSToS3(event, null, uploadToS3);
    const icsUrl = getS3Url(icsS3Key);
    calendarLinks.ics = icsUrl;
    const calendarButtonsHTML = generateCalendarButtonsHTML(calendarLinks);

    // 3. ID de orden de referencia
    const orderId = tickets[0]?.orderId ?? tickets[0]?.id ?? "N/A";

    // Configuración de Transporter (SendGrid)
    const transporter = nodemailer.createTransport({
      service: "SendGrid",
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });

    // --- HTML UNIFICADO (Premium + Enlaces Directos) ---
    const mailOptions = {
      from: sender,
      to: user.email,
      subject: `✨ ${quantity > 1 ? "Tus pases confirmados" : "Tu pase confirmado"} — ${event.title}`,
      html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background-color: #FFF5F8; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 40px rgba(61, 43, 47, 0.05); border: 1px solid #FFD9E2; }
    .header { background-color: #3D2B2F; padding: 40px 20px; text-align: center; }
    .header-eyebrow { color: #E53888; font-size: 11px; text-transform: uppercase; letter-spacing: 4px; font-weight: 900; margin-bottom: 10px; display: block; }
    .header h1 { color: #ffffff; margin: 10px 0; font-size: 28px; font-weight: 300; }
    .header h1 span { color: #E53888; font-weight: 800; }
    
    .content { padding: 40px 30px; }
    .greeting { color: #3D2B2F; font-size: 22px; font-weight: 800; margin: 0 0 10px 0; }
    .subtext { color: #5C464A; font-size: 15px; line-height: 1.6; margin-bottom: 30px; }
    
    .event-info { background-color: #FFF5F8; border-radius: 16px; padding: 25px; border: 1px solid #FFD9E2; margin-bottom: 30px; }
    .info-label { font-size: 10px; color: #E53888; text-transform: uppercase; font-weight: 900; letter-spacing: 1px; }
    .info-value { font-size: 16px; color: #3D2B2F; font-weight: 700; margin: 4px 0 15px 0; }
    
    .ticket-row { padding: 15px 0; border-bottom: 1px solid #FFF5F8; }
    .ticket-id-label { font-size: 10px; color: #E53888; text-transform: uppercase; font-weight: 900; }
    .ticket-code { font-size: 18px; font-weight: 900; color: #3D2B2F; font-family: monospace; }
    .btn-ticket { background-color: #E53888; color: #ffffff !important; padding: 10px 20px; text-decoration: none; border-radius: 10px; font-size: 11px; font-weight: 900; text-transform: uppercase; display: inline-block; }
    
    .calendar-box { text-align: center; padding: 20px 0; border-top: 1px solid #FFF5F8; margin-top: 20px; }
    .footer { padding: 30px; text-align: center; background-color: #FFF5F8; border-top: 1px solid #FFD9E2; }
    .footer-text { font-size: 11px; color: #5C464A; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="header-eyebrow">Acceso Confirmado</span>
      <h1>¡Tu compra fue <span>exitosa!</span></h1>
      <p style="color: rgba(255,255,255,0.6); font-size: 12px; font-weight: 700;">WTC CIUDAD DE MÉXICO</p>
    </div>

    <div class="content">
      <p class="greeting">¡Hola, ${user.name || "Invitado"}! 👋</p>
      <p class="subtext">
        Tu registro para <strong>${event.title}</strong> está listo. 
        A continuación encontrarás tus accesos directos. No necesitas iniciar sesión para verlos.
      </p>

      <div class="event-info">
        <p class="info-label">Evento</p>
        <p class="info-value" style="color: #E53888;">${event.title}</p>
        
        <table width="100%">
          <tr>
            <td>
              <p class="info-label">Fecha</p>
              <p class="info-value" style="font-size: 14px;">${new Date(event.startDate).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</p>
            </td>
            <td align="right">
              <p class="info-label">Total Pagado</p>
              <p class="info-value" style="font-size: 14px;">$${total.toFixed(2)} MXN</p>
            </td>
          </tr>
        </table>
      </div>

      <h4 style="color: #3D2B2F; text-transform: uppercase; letter-spacing: 2px; font-size: 13px; margin-bottom: 20px; border-bottom: 2px solid #FFF5F8; padding-bottom: 10px;">
        Tus Pases Digitales (${quantity})
      </h4>

      <table width="100%" cellpadding="0" cellspacing="0">
        ${tickets
          .map(
            (ticket) => `
          <tr class="ticket-row">
            <td>
              <span class="ticket-id-label">ID DE ENTRADA</span><br/>
              <span class="ticket-code">${ticket.code || ticket.id}</span>
            </td>
            <td align="right">
              <a href="https://eventoswapizima.com/ticket/${ticket.code || ticket.id}" class="btn-ticket">
                VER TICKET
              </a>
            </td>
          </tr>
        `,
          )
          .join("")}
      </table>

      ${
        calendarButtonsHTML
          ? `
        <div class="calendar-box">
          <p style="font-size: 11px; color: #5C464A; margin-bottom: 10px; font-weight: 700; text-transform: uppercase;">Añadir a mi calendario</p>
          ${calendarButtonsHTML}
        </div>
      `
          : ""
      }

      <div style="background-color: #3D2B2F; border-radius: 12px; padding: 15px; margin-top: 30px; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #ffffff; font-weight: 500;">
          Presenta estos códigos en el WTC para recibir tus pulseras.
        </p>
      </div>
    </div>

    <div class="footer">
      <p class="footer-text">
        Orden #${orderId}<br/>
        © 2026 FLORECIENDO JUNTAS - Wapizima Official.
      </p>
    </div>
  </div>
</body>
</html>`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email (Open Flow) enviado a ${user.email}`);

    return { icsUrl, calendarLinks };
  } catch (error) {
    console.error("❌ Error enviando email de confirmación (Open):", error);
    throw error;
  }
};

module.exports = sendTicketMailOpen;
