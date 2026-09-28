// templates/templateB_Deposit.js
const emailLayout = require("./emailLayout");

module.exports = ({
  buyerName,
  eventTitle,
  folio,
  paidAmount,
  pendingAmount,
  dueDate,
  clientUrl,
}) => {
  const formattedDueDate = new Date(dueDate).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
    <h1 style="margin:0 0 8px 0; font-size: 24px; font-weight: 900; color: #18181b; text-transform: uppercase;">
      ¡Reserva <span style="color: #ec4899;">Confirmada</span>! 📋
    </h1>
    <p style="margin: 0 0 24px 0; font-size: 12px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em;">
      ${eventTitle}
    </p>

    <p style="font-size: 14px; color: #3f3f46; text-align: left; line-height: 1.6;">
      Hola <strong>${buyerName}</strong>,
    </p>
    <p style="font-size: 14px; color: #3f3f46; text-align: left; line-height: 1.6;">
      Hemos recibido correctamente tu pago inicial de apartado (60%). Tus asientos están asegurados para el evento.
    </p>

    <div style="background-color: #fff0f5; border: 1px dashed #f43f5e; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: center;">
      <p style="margin:0; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase;">FOLIO DE RESERVA</p>
      <h3 style="margin: 4px 0 16px 0; font-size: 22px; font-weight: 800; color: #18181b;">${folio}</h3>
      
      <div style="display: flex; justify-content: space-between; background: #ffffff; padding: 12px; border-radius: 10px; margin-bottom: 16px;">
        <div>
          <span style="font-size: 10px; color: #71717a; display: block;">PAGADO (60%)</span>
          <strong style="font-size: 14px; color: #16a34a;">$${paidAmount} MXN</strong>
        </div>
        <div>
          <span style="font-size: 10px; color: #71717a; display: block;">PENDIENTE (40%)</span>
          <strong style="font-size: 14px; color: #dc2626;">$${pendingAmount} MXN</strong>
        </div>
      </div>

      <p style="margin:0 0 16px 0; font-size: 12px; font-weight: 700; color: #be123c;">
        ⏰ FECHA LÍMITE DE LIQUIDACIÓN: ${formattedDueDate}
      </p>

      <a href="${clientUrl}/liquidar/${folio}" target="_blank" style="display: inline-block; background-color: #ec4899; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; text-transform: uppercase; padding: 14px 28px; border-radius: 12px;">
        LIQUIDAR 40% RESTANTE
      </a>
    </div>

    <p style="font-size: 12px; color: #71717a; text-align: center; line-height: 1.5;">
      Una vez completado el pago del 40% restante, tus accesos digitales dinámicos con código QR se liberarán automáticamente.
    </p>
  `;

  return emailLayout(content);
};
