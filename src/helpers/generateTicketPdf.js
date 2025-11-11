const puppeteer = require("puppeteer");
const { Event, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");

/**
 * 🎟️ Genera HTML del ticket con diseño premium y emojis a color
 */

const generateTicketHTML = (ticket, event, user) => {
  const formattedDate = event.startDate
    ? new Date(event.startDate).toLocaleDateString("es-MX", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "America/Mexico_City",
      })
    : "Fecha por confirmar";

  const formattedTime = event.startDate
    ? new Date(event.startDate).toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Mexico_City",
      })
    : "";

  const dateText =
    formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
  const fullDateTime = dateText + (formattedTime ? ` • ${event.time}` : "");

  return `
<!DOCTYPE html>
<html lang="es">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f3f4f6;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 0px;
    }

    .ticket-container {
      width: 595px;
      height: 280px;
      background: linear-gradient(180deg, #F3B9CD 0%, #F6C8D7 100%);
      border-radius: 0;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      position: relative;
      overflow: hidden;
      display: flex;
    }

    /* Efectos decorativos de fondo */
    .ticket-container::before {
      content: '';
      position: absolute;
      width: 360px;
      height: 360px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(236, 72, 153, 0.05) 0%, transparent 70%);
      top: -180px;
      left: -100px;
    }

    .ticket-container::after {
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.05) 0%, transparent 70%);
      bottom: -200px;
      right: -100px;
    }

    /* Sección izquierda - QR */
    .left-section {
      width: 210px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      z-index: 1;
    }

    .ticket-label {
      font-size: 10px;
      font-weight: 600;
      color: #D72E79;
      letter-spacing: 1px;
      margin-bottom: 20px;
      text-transform: uppercase;
    }

    .qr-wrapper {
      background: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      margin-bottom: 15px;
    }

    .qr-code {
      width: 140px;
      height: 140px;
      display: block;
    }

    .ticket-code {
      font-family: 'Courier New', monospace;
      font-size: 9px;
      font-weight: bold;
      color: #D72E79;
      letter-spacing: 1px;
      text-align: center;
      margin-top: 10px;
    }

    /* Línea divisoria punteada */
    .divider {
      width: 1px;
      background: linear-gradient(to bottom, #D72E79 50%, transparent 50%);
      background-size: 1px 10px;
      background-repeat: repeat-y;
      position: relative;
    }

    .scissors {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      color: #fff;
      background: #D72E79;
      padding: 5px;
    }

    /* Sección derecha - Información */
    .right-section {
      /* Quita la imagen de aquí y deja el color base */
      background-color: #F3B9CD;
      flex: 1;
      padding: 30px;
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 1;
      /* Esto es para que el contenido quede por encima del ::before */
    }

    .right-section::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background:
        url('https://floreciendojuntas1.s3.us-east-2.amazonaws.com/local/Statics/TEDDY+CAROLINA+TAVERA+(1).png') center right 30px/65% no-repeat,
        #F3B9CD;
      /* Se mantiene el color para la mezcla */
      background-blend-mode: multiply;

      /* Aplica la opacidad SOLAMENTE al pseudo-elemento (donde está la imagen) */
      opacity: 0.3;
      /* <-- Opacidad de la imagen */

      z-index: -1;
      /* Manda esta capa detrás del contenido de .right-section */
    }

    .accent-bar {
      position: absolute;
      top: 20px;
      left: 30px;
      right: 30px;
      height: 3px;
      background: linear-gradient(90deg, #ec4899 0%, #8b5cf6 100%);
      border-radius: 2px;
    }

    .attendee-section {
      margin-top: -10px;
      margin-bottom: 20px;
    }

    .label {
      font-size: 10px;
      font-weight: 600;
      color: #D72E79;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
      text-transform: uppercase;
    }

    .attendee-name {
      font-size: 16px;
      font-weight: bold;
      color: #ffffff;
      margin: 0;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .event-title {
      font-size: 20px;
      font-weight: bold;
      color: #ec4899;
      margin: 0 0 15px 0;
      line-height: 1.2;
      text-transform: uppercase;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .info-group {
      margin-bottom: 15px;
    }

    .info-content {
      font-size: 12px;
      color: #fff;
      margin: 0;
      line-height: 1.4;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .footer {
      margin-top: -10px;
      padding-top: -20px;
    }

    .footer-text {
      font-size: 10px;
      color: #D72E79;
      font-style: italic;
      margin: 0 0 5px 0;
    }

    .ticket-id {
      font-size: 8px;
      font-weight: bold;
      color: #475569;
      text-align: right;
      margin: 0;
    }
  </style>
</head>

<body>
  <div class="ticket-container">
    <!-- Sección Izquierda: QR -->
    <div class="left-section">
      <div class="ticket-label">Boleto de Entrada</div>
      <div class="qr-wrapper">
        <img
          src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(ticket.code)}&bgcolor=ffffff&color=1f2937&margin=0"
          alt="QR Code" class="qr-code">
      </div>
      <div class="ticket-code">${ticket.code}</div>
    </div>

    <!-- Línea divisoria -->
    <div class="divider">
      <div class="scissors">✂</div>
    </div>

    <!-- Sección Derecha: Información -->
    <div class="right-section">

      <div class="attendee-section">
        <div class="label">Asistente</div>
        <h2 class="attendee-name">${user.name || "Invitado Especial"}</h2>
      </div>

      <h1 class="event-title">${event.title || "Evento Especial"}</h1>

      <div class="info-group">
        <div class="label">📅 Fecha y Hora</div>
        <p class="info-content">${fullDateTime}</p>
      </div>
      <div class="info-group">
        <div class="label">📍 Ubicación</div>
        <p class="info-content">${event.location}</p>
      </div>
      <div class="footer">
        <p class="footer-text">Presenta este boleto digital en la entrada del evento • No se permiten devoluciones</p>
        <p class="ticket-id">#${ticket.id}</p>
      </div>
    </div>
  </div>
</body>

</html>
  `;
};

/**
 * 🎟️ Genera un PDF premium con Puppeteer (soporta emojis a color)
 */
const generateTicketPDF = async (ticket) => {
  const event = await Event.findByPk(ticket.eventId);
  const user = await User.findOne({
    where: { email: ticket.buyerEmail },
  });

  if (!event || !user) throw new Error("Evento o usuario no encontrado");

  // Generar HTML del ticket
  const html = generateTicketHTML(ticket, event, user);

  // Lanzar Puppeteer

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  // Establecer contenido HTML
  await page.setContent(html, {
    waitUntil: "networkidle0",
  });

  // Generar PDF con dimensiones exactas
  const pdfBuffer = await page.pdf({
    width: "595px",
    height: "280px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();

  // 🟢 Subir PDF a S3
  const pdfFileObject = {
    originalname: `ticket_${ticket.id}.pdf`,
    buffer: pdfBuffer,
    mimetype: "application/pdf",
  };

  const s3Key = await uploadToS3("tickets", pdfFileObject, ticket.id);
  const publicUrl = getS3Url(s3Key);

  console.log(`✅ Ticket PDF generado con Puppeteer: ${publicUrl}`);
  return publicUrl;
};

module.exports = generateTicketPDF;
