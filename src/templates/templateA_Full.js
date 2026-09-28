// templates/templateA_Full.js
const emailLayout = require("./emailLayout");

module.exports = ({ buyerName, eventTitle, folio, tickets, clientUrl }) => {
  const ticketsHtml = tickets
    .map((ticket, index) => {
      // 1. Obtener el código único del boleto (UUID)
      const ticketCode = ticket.code || ticket.id;

      // 2. Extraer los primeros 8 caracteres para la vista corta (ej. "4EE79460")
      const shortCode = ticketCode
        ? ticketCode.split("-")[0].toUpperCase()
        : folio;

      // 3. Generar la URL directa individual: url/ticket/code
      const ticketUrl = `${clientUrl}/ticket/${ticketCode}`;

      return `
        <div style="background-color: #fff0f5; border: 1px solid #fce7f3; border-radius: 16px; padding: 24px; margin-top: 20px; text-align: center;">
          <p style="margin: 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #db2777; letter-spacing: 0.05em;">
            ${ticket.seatName || "ACCESO INDIVIDUAL"} · BOLETO #${index + 1}
          </p>
          
          <!-- Mostramos únicamente la versión corta y legible -->
          <h2 style="margin: 10px 0 16px 0; font-size: 28px; font-weight: 800; color: #18181b; letter-spacing: 0.05em;">
            ${shortCode}
          </h2>
          
          <!-- El botón apunta a /ticket/${ticket.code} completo -->
          <a href="${ticketUrl}" target="_blank" style="display: inline-block; background-color: #ec4899; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; text-transform: uppercase; padding: 14px 28px; border-radius: 12px; letter-spacing: 0.025em;">
            VER BOLETO DIGITAL
          </a>
          
          <p style="margin: 14px 0 0 0; font-size: 11px; color: #71717a;">
            Presenta este código digital o bájalo impreso el día del acceso.
          </p>
        </div>
      `;
    })
    .join("");

  const content = `
    <h1 style="margin:0 0 8px 0; font-size: 24px; font-weight: 900; color: #18181b; text-transform: uppercase;">
      ¡Tus accesos están <span style="color: #ec4899;">Listos</span>! 🎉
    </h1>
    <p style="margin: 0 0 24px 0; font-size: 12px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em;">
      ${eventTitle}
    </p>

    <p style="font-size: 14px; color: #3f3f46; text-align: left; line-height: 1.6;">
      Hola <strong>${buyerName}</strong>,
    </p>
    <p style="font-size: 14px; color: #3f3f46; text-align: left; line-height: 1.6;">
      Tu pago ha sido procesado de forma segura y exitosa. A continuación, te entregamos tus accesos oficiales para el evento. Puedes dar clic en el botón de cada tarjeta para abrir el pase digital dinámico:
    </p>

    ${ticketsHtml}

    <div style="background-color: #f4f4f5; border-left: 4px solid #ec4899; border-radius: 8px; padding: 14px; margin-top: 28px; text-align: left;">
      <p style="margin:0; font-size: 12px; color: #52525b; line-height: 1.5;">
        <strong>Nota de seguridad:</strong> Cada boleto digital contiene un código QR único que será escaneado en la entrada. No compartas este correo ni los códigos con nadie para evitar accesos duplicados.
      </p>
    </div>
  `;

  return emailLayout(content);
};
