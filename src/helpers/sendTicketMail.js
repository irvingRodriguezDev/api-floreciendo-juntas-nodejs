const {
  generateCalendarLinks,
  saveICSToS3,
  generateCalendarButtonsHTML,
} = require("./generateCalendarLinks");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");
const nodemailer = require("nodemailer");
const sender = process.env.SENGRID_FROM;

/**
 * 📧 Envía el ticket por email con opciones de calendario
 */
const sendTicketEmail = async (tickets, event, user) => {
  try {
    // 1. Calcular resumen de compra desde el array de tickets
    const quantity = tickets.length;
    const unitPrice = event?.price ?? 0;

    const total = unitPrice * quantity;

    // 2. Generar enlaces de calendario (sin pdfUrl ni ticketId individuales)
    const calendarLinks = generateCalendarLinks(event);

    // 3. Guardar archivo ICS en S3
    const icsS3Key = await saveICSToS3(event, null, uploadToS3);
    const icsUrl = getS3Url(icsS3Key);
    calendarLinks.ics = icsUrl;

    // 4. Generar HTML de botones de calendario
    const calendarButtonsHTML = generateCalendarButtonsHTML(calendarLinks);

    // 5. URL del perfil donde descargarán sus boletos
    const profileUrl = `${process.env.FRONTEND_URL}/perfil/boletos`;

    // 6. ID de orden (tomado del primer ticket como referencia)
    const orderId = tickets[0]?.orderId ?? tickets[0]?.id;

    const transporter = nodemailer.createTransport({
      service: "SendGrid",
      auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY },
    });

    const mailOptions = {
      from: sender,
      to: user.email,
      subject: `✅ Confirmación de compra — ${event.title}`,
      html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #fdf6f9; font-family: 'DM Sans', sans-serif; color: #2d1a24; padding: 40px 20px; }
    .wrapper { max-width: 580px; margin: 0 auto; }
    .header { background: #1a0d13; border-radius: 16px 16px 0 0; padding: 48px 40px 36px; text-align: center; position: relative; overflow: hidden; }
    .header::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(236,72,153,0.35) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 90% 100%, rgba(243,185,205,0.2) 0%, transparent 60%); }
    .header-eyebrow { font-family: 'DM Sans', sans-serif; font-size: 10px; font-weight: 500; letter-spacing: 3px; text-transform: uppercase; color: #F3B9CD; opacity: 0.8; margin-bottom: 16px; position: relative; }
    .header h1 { font-family: 'Cormorant Garamond', serif; font-size: 38px; font-weight: 300; color: #ffffff; line-height: 1.15; position: relative; letter-spacing: -0.5px; }
    .header h1 span { color: #F3B9CD; font-style: italic; }
    .header-line { width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #ec4899, transparent); margin: 20px auto 0; position: relative; }
    .body { background: #ffffff; padding: 44px 40px; border: 1px solid #f0e0e8; border-top: none; }
    .greeting { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 400; color: #1a0d13; margin-bottom: 10px; }
    .subtext { font-size: 14px; color: #7a5568; line-height: 1.7; margin-bottom: 36px; }
    .subtext strong { color: #c2185b; font-weight: 500; }
    .event-card { background: #fdf6f9; border: 1px solid #f3d0de; border-radius: 12px; padding: 28px; margin-bottom: 32px; position: relative; }
    .event-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: linear-gradient(180deg, #ec4899, #F3B9CD); border-radius: 12px 0 0 12px; }
    .event-title-label { font-size: 10px; font-weight: 500; letter-spacing: 2.5px; text-transform: uppercase; color: #ec4899; margin-bottom: 8px; }
    .event-name { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 600; color: #1a0d13; margin-bottom: 24px; line-height: 1.2; }
    .info-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-icon { width: 32px; height: 32px; background: #fff0f5; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
    .info-label { font-size: 10px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; color: #ec4899; margin-bottom: 2px; }
    .info-value { font-size: 13px; color: #2d1a24; font-weight: 400; line-height: 1.4; }
    .purchase-summary { background: #fdf6f9; border: 1px solid #f3d0de; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
    .purchase-summary-label { font-size: 10px; font-weight: 500; letter-spacing: 2.5px; text-transform: uppercase; color: #ec4899; margin-bottom: 14px; }
    .summary-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #7a5568; padding: 6px 0; border-bottom: 1px dashed #f3d0de; }
    .summary-row:last-child { border-bottom: none; padding-top: 12px; margin-top: 4px; }
    .summary-row.total { font-weight: 500; color: #1a0d13; font-size: 14px; }
    .summary-row.total .summary-value { color: #c2185b; font-weight: 600; }
    .cta-wrapper { text-align: center; margin: 36px 0; }
    .cta-button { display: inline-block; background: #1a0d13; color: #ffffff !important; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-size: 13px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; border: 1px solid #ec4899; }
    .cta-sub { font-size: 11px; color: #b08090; margin-top: 10px; line-height: 1.6; }
    .cta-sub strong { color: #c2185b; }
    .calendar-section { margin: 28px 0; }
    .calendar-label { font-size: 11px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; color: #b08090; text-align: center; margin-bottom: 14px; }
    .notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px 20px; margin: 24px 0; display: flex; gap: 12px; align-items: flex-start; }
    .notice-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .notice-text { font-size: 12.5px; color: #78350f; line-height: 1.6; }
    .footer { background: #fdf6f9; border: 1px solid #f0e0e8; border-top: none; border-radius: 0 0 16px 16px; padding: 28px 40px; text-align: center; }
    .footer-brand { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 600; color: #1a0d13; letter-spacing: 1px; margin-bottom: 8px; }
    .footer-meta { font-size: 11px; color: #b08090; line-height: 1.8; }
    .footer-id { display: inline-block; margin-top: 12px; font-size: 10px; letter-spacing: 1.5px; color: #d4a0b5; text-transform: uppercase; background: #fff0f5; padding: 4px 12px; border-radius: 20px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <p class="header-eyebrow">Confirmación de compra</p>
      <h1>¡Tu compra fue<br><span>exitosa!</span></h1>
      <div class="header-line"></div>
    </div>

    <div class="body">
      <p class="greeting">Hola, ${user.name || "Invitado"} 👋</p>
      <p class="subtext">
        Hemos confirmado tu compra para <strong>${event.title}</strong>.
        Puedes descargar tus boletos en cualquier momento desde tu perfil.
      </p>

      <div class="event-card">
        <p class="event-title-label">Evento</p>
        <h2 class="event-name">${event.title || "Evento Especial"}</h2>

        <div class="info-row">
          <div class="info-icon">📅</div>
          <div>
            <p class="info-label">Fecha</p>
            <p class="info-value">${new Date(
              event.startDate,
            ).toLocaleDateString("es-MX", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "America/Mexico_City",
            })}</p>
          </div>
        </div>

        <div class="info-row">
          <div class="info-icon">⏰</div>
          <div>
            <p class="info-label">Hora</p>
            <p class="info-value">${new Date(
              event.startDate,
            ).toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Mexico_City",
            })} hrs</p>
          </div>
        </div>

        ${
          event.location
            ? `
        <div class="info-row">
          <div class="info-icon">📍</div>
          <div>
            <p class="info-label">Lugar</p>
            <p class="info-value">${event.location}</p>
          </div>
        </div>`
            : ""
        }
      </div>

      <div class="purchase-summary">
        <p class="purchase-summary-label">Resumen de compra</p>
        <div class="summary-row">
          <span>Boletos adquiridos </span>
           <span> <b> ${quantity} </b> boleto${quantity > 1 ? "s" : ""}</span>
        </div>
        <div class="summary-row">
          <span>Precio por boleto </span>
          <span><b>
          $${unitPrice.toFixed(2)} MXN
          </b> </span>
        </div>
        <div class="summary-row total">
          <span>Total pagado</span>
          <span class="summary-value">$${total.toFixed(2)} MXN</span>
        </div>
      </div>

      <div class="cta-wrapper">
        <a href="${profileUrl}" class="cta-button">Ver mis boletos</a>
        <p class="cta-sub">
          Ingresa a tu perfil para descargar tus boletos.<br>
          <strong>Recuerda presentarlos al ingresar al evento.</strong>
        </p>
      </div>

      ${
        calendarButtonsHTML
          ? `
      <div class="calendar-section">
        <p class="calendar-label">Agregar a mi calendario</p>
        ${calendarButtonsHTML}
      </div>`
          : ""
      }

      <div class="notice">
        <span class="notice-icon">⚠️</span>
        <p class="notice-text">
          <strong>Importante:</strong> Presenta tu boleto (PDF impreso o en pantalla) al momento de ingresar.
          Los boletos son personales e intransferibles. No se permiten devoluciones.
        </p>
      </div>
    </div>

    <div class="footer">
      <p class="footer-brand">${event.title || "Eventos"}</p>
      <p class="footer-meta">
        Este es un mensaje automático de confirmación de compra.<br>
        Por favor no respondas directamente a este correo.
      </p>
      <span class="footer-id">Orden #${orderId}</span>
    </div>
  </div>
</body>
</html>`,
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: false },
      },
    };

    await transporter.sendMail(mailOptions);
    console.log(
      `✅ Email de confirmación enviado a ${user.email} — ${quantity} boleto(s)`,
    );

    return { icsUrl, calendarLinks };
  } catch (error) {
    console.error("❌ Error enviando email de confirmación:", error);
    throw error;
  }
};

module.exports = sendTicketEmail;
