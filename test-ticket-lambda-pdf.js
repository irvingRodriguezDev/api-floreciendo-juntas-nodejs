const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const fs = require("fs");
require("dotenv").config();

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});

/**
 * Simular datos de ticket para prueba
 */
const mockTicketData = {
  ticket: {
    id: "TEST-001",
    code: "ABC123XYZ789",
  },
  event: {
    title: "Evento de Prueba 2025",
    startDate: new Date("2025-12-25T19:00:00"),
    time: "19:00",
    location: "Centro de Convenciones - Ciudad de México",
  },
  user: {
    name: "Ana María González",
  },
};

/**
 * Generar HTML del ticket (copia de tu función original)
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
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
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      position: relative;
      overflow: hidden;
      display: flex;
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
 * 🧪 Probar generación de ticket real
 */
const testTicketLambda = async () => {
  try {
    console.log("🎟️  Iniciando prueba con ticket real...\n");

    const { ticket, event, user } = mockTicketData;
    const html = generateTicketHTML(ticket, event, user);

    const lambdaPayload = {
      html: html,
      width: "595px",
      height: "280px",
      fileName: `ticket_${ticket.id}.pdf`,
    };

    console.log("📤 Invocando Lambda...");
    const startTime = Date.now();

    const command = new InvokeCommand({
      FunctionName:
        process.env.LAMBDA_PDF_FUNCTION_NAME || "puppeteer-pdf-generator",
      Payload: JSON.stringify(lambdaPayload),
    });

    const lambdaResponse = await lambdaClient.send(command);
    const duration = Date.now() - startTime;

    const responsePayload = JSON.parse(
      Buffer.from(lambdaResponse.Payload).toString()
    );

    if (responsePayload.statusCode !== 200) {
      throw new Error(`Lambda error: ${JSON.stringify(responsePayload)}`);
    }

    const pdfBuffer = Buffer.from(responsePayload.body, "base64");
    const outputPath = `./ticket_${ticket.id}_test.pdf`;
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`\n✅ Ticket generado exitosamente!`);
    console.log(`📁 Archivo: ${outputPath}`);
    console.log(`📊 Tamaño: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`⚡ Tiempo: ${duration}ms`);
    console.log(`\n🎉 ¡Abre el PDF para verificar que se vea bien!\n`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
};

testTicketLambda();
