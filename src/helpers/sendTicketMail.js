const nodemailer = require("nodemailer");
const { Event } = require("../models");

const sendTicketEmail = async (email, qrUrl, ticket) => {
  const event = await Event.findByPk(ticket.eventId);
  const sender = process.env.SENGRID_FROM;

  const transporter = nodemailer.createTransport({
    service: "SendGrid",
    auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY },
  });

  const mailOptions = {
    from: sender,
    to: email,
    subject: "🎟️ Tu boleto para " + event.title,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 2px solid #4CAF50; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #4CAF50; color: white; text-align: center; padding: 20px;">
          <h1>🎫 Boleto de Evento</h1>
          <h2>${event.title}</h2>
        </div>

        <div style="padding: 20px;">
          <p>¡Tu compra fue exitosa!</p>
          <p><strong>Nombre del titular:</strong> ${ticket.buyerName}</p>
          <p><strong>Correo:</strong> ${ticket.buyerEmail}</p>
          <p><strong>Fecha del evento:</strong> ${new Date(event.startDate).toLocaleString()}</p>
          <p><strong>Lugar:</strong> ${event.location}</p>

          <div style="text-align: center; margin: 30px 0;">
            <img src="${qrUrl}" alt="QR Ticket" style="width: 200px; height: 200px;"/>
          </div>

          <p style="text-align: center;">
            Descarga tu boleto haciendo click en el botón:
          </p>

          <div style="text-align: center; margin: 20px 0;">
            <a href="${qrUrl}" target="_blank" style="background-color: #4CAF50; color: white; text-decoration: none; padding: 15px 25px; border-radius: 5px; display: inline-block;">
              Descargar Boleto
            </a>
          </div>

          <p style="font-size: 12px; color: #555;">
            Presenta este código QR en la entrada del evento. Este boleto es personal e intransferible.
          </p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendTicketEmail;
