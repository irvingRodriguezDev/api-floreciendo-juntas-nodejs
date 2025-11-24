const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { Event, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");

// Inicializar cliente Lambda
const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});
/**
 * 🎟️ Genera HTML del ticket con diseño premium
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

    .right-section {
      background-color: #F3B9CD;
      flex: 1;
      padding: 30px;
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 1;
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
      background-blend-mode: multiply;
      opacity: 0.3;
      z-index: -1;
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
    <div class="left-section">
      <div class="ticket-label">Boleto de Entrada</div>
      <div class="qr-wrapper">
        <img
          src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(ticket.code)}&bgcolor=ffffff&color=1f2937&margin=0"
          alt="QR Code" class="qr-code">
      </div>
      <div class="ticket-code">${ticket.code}</div>
    </div>

    <div class="divider">
      <div class="scissors">✂</div>
    </div>

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
 * 🎟️ Genera un PDF invocando Lambda (sin Puppeteer local)
 */
const generateTicketPDF = async (ticket) => {
  try {
    const event = await Event.findByPk(ticket.eventId);
    const user = await User.findOne({
      where: { email: ticket.buyerEmail },
    });

    if (!event || !user) {
      throw new Error("Evento o usuario no encontrado");
    }

    const html = generateTicketHTML(ticket, event, user);

    const cmd = new InvokeCommand({
      FunctionName:
        process.env.LAMBDA_PDF_FUNCTION_NAME || "createLambdaPdfWithPuppeter",
      Payload: JSON.stringify({
        html,
        ticketId: ticket.id,
      }),
    });

    const raw = await lambda.send(cmd);
    const response = JSON.parse(Buffer.from(raw.Payload).toString());

    if (response.statusCode !== 200) {
      throw new Error(`Lambda error: ${response.body}`);
    }

    const { key, url } = JSON.parse(response.body);

    // 👀 Opcional: si quieres formatear la URL con tu helper
    const finalUrl = getS3Url ? getS3Url(key) : url;

    return finalUrl;
  } catch (err) {
    console.error("Error generando PDF:", err);
    throw err;
  }
};

module.exports = generateTicketPDF;
