const generateTicketPdf = require("./generateTicketPdf");
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
const sendTicketEmail = async (ticket, event, user) => {
  try {
    // 1. Generar PDF del ticket
    const pdfUrl = await generateTicketPdf(ticket);
    const eventTitle = event.title;
    // 2. Generar enlaces de calendario
    const calendarLinks = generateCalendarLinks(event, pdfUrl, ticket.id);

    // 3. Guardar archivo ICS en S3
    const icsS3Key = await saveICSToS3(event, pdfUrl, uploadToS3, ticket.id);
    const icsUrl = getS3Url(icsS3Key);

    // Actualizar el link de ICS con la URL de S3
    calendarLinks.ics = icsUrl;

    // 4. Generar HTML de botones
    const calendarButtonsHTML = generateCalendarButtonsHTML(calendarLinks);
    const transporter = nodemailer.createTransport({
      service: "SendGrid",
      auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY },
    });
    // 5. Enviar email
    const mailOptions = {
      from: sender,
      to: user.email,
      subject: `🎟️ Tu boleto para ${event.title}`,
      html: `
       <!DOCTYPE html>
        <html>
            
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
            
        <body
          style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px;">
            
          <div
            style="background: linear-gradient(135deg, #E36F9E 0%, #EFABC6 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎉 ¡Gracias por tu compra!</h1>
          </div>
            
          <div
            style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            
            <p style="font-size: 16px;">Hola <strong>${user.name || "Invitado"}</strong>,</p>
            
            <p style="font-size: 16px;">Tu boleto para <strong style="color: #EC4899;">${event.title}</strong> está listo.</p>
            
            <!-- Información del evento -->
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>📅 Fecha:</strong> ${new Date(
                event.startDate
              ).toLocaleDateString("es-MX", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "America/Mexico_City",
              })}</p>
              <p style="margin: 5px 0;"><strong>⏰ Hora:</strong> ${new Date(
                event.startDate
              ).toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Mexico_City",
              })}</p>
              ${event.location ? `<p style="margin: 5px 0;"><strong>📍 Lugar:</strong> ${event.location}</p>` : ""}
              <p style="margin: 5px 0;"><strong>🎫 Código:</strong> <code
                  style="background: #e5e7eb; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${ticket.code}</code>
              </p>
            </div>
            
            <!-- Botón de descarga del ticket -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${pdfUrl}"
                 download="mi_boleto_${eventTitle}.pdf"
                 style="background: #ec4899; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(236, 72, 153, 0.3);">
                 📄 Descargar mi boleto PDF
              </a>
            </div>
            
            ${calendarButtonsHTML}
            
            <!-- Instrucciones -->
            <div
              style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; color: #92400e; font-size: 14px;">
                <strong>⚠️ Importante:</strong> Presenta este boleto (PDF o en tu teléfono) al ingresar al evento.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <p style="font-size: 14px; color: #6b7280; text-align: center;">
              ¿Tienes preguntas? Contáctanos respondiendo a este correo.
            </p>
            
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 20px;">
              Este es un correo automático, por favor no respondas directamente.<br>
              Ticket #${ticket.id} • ${event.title}
            </p>
            
          </div>
            
        </body>
            
        </html>
      `,
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: false },
      },
    };

    console.log(`✅ Email enviado a ${user.email} con opciones de calendario`);
    await transporter.sendMail(mailOptions);
    return { pdfUrl, icsUrl, calendarLinks };
  } catch (error) {
    console.error("Error enviando ticket por email:", error);
    throw error;
  }
};

module.exports = sendTicketEmail;
