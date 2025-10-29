const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const { Event, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");

/**
 * 🎟️ Genera un PDF tipo pase de abordar (elegante) con QR y lo sube a S3
 */
const generateTicketPDF = async (ticket) => {
  const event = await Event.findByPk(ticket.eventId);
  const user = await User.findOne({
    where: { email: ticket.buyerEmail.toLowerCase() },
  });

  if (!event || !user) throw new Error("Evento o usuario no encontrado");

  // 🟣 Generar QR en memoria
  const qrBuffer = await QRCode.toBuffer(ticket.code, {
    type: "png",
    width: 200,
  });

  // 🧾 Crear documento horizontal tipo pase de abordar
  const doc = new PDFDocument({
    size: [400, 220], // Horizontal y compacto
    layout: "landscape",
    margin: 15,
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  // 🎨 Fondo general
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
  doc.restore();

  // --- Nombre del comprador ---
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text(user.name || "Cliente", 0, 18, { align: "center" });

  // --- QR centrado ---
  const qrSize = 200;
  const qrX = (doc.page.width - qrSize) / 2;
  const qrY = 40;
  doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize] });

  // --- Fecha ---
  const formattedDate = event.startDate
    ? new Date(event.startDate).toLocaleDateString("es-MX", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Por definir";

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#6b7280")
    .text(formattedDate, 0, qrY + qrSize + 5, { align: "center" });

  // --- Título del evento (ajuste automático) ---
  let fontSize = 16;
  const maxWidth = doc.page.width - 40;
  doc.font("Helvetica-Bold").fillColor("#ec4899");
  while (
    fontSize > 10 &&
    doc.widthOfString(event.title?.toUpperCase() || "") > maxWidth
  ) {
    fontSize -= 1;
    doc.fontSize(fontSize);
  }
  doc.text(event.title?.toUpperCase() || "EVENTO", 0, qrY + qrSize + 25, {
    align: "center",
  });

  // --- Lugar ---
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#4b5563")
    .text(event.location || "Lugar por definir", 0, doc.y + 3, {
      align: "center",
    });

  // --- Línea divisoria ---
  const dividerY = doc.y + 10;
  doc
    .moveTo(1, dividerY)
    .lineTo(doc.page.width - 40, dividerY)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  // --- Pie de página ---
  const footerY = doc.y + 25;
  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor("#6b7280")
    .text("Gracias por tu compra", 0, footerY, { align: "center" })
    .text("Presenta este boleto al ingresar al evento", 0, footerY + 20, {
      align: "center",
    });

  // --- Finalizar documento ---
  doc.end();

  const pdfBuffer = await new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });

  // 🟢 Subir PDF a S3
  const pdfFileObject = {
    originalname: `ticket_${ticket.id}.pdf`,
    buffer: pdfBuffer,
    mimetype: "application/pdf",
  };

  const s3Key = await uploadToS3("tickets", pdfFileObject, ticket.id);
  const publicUrl = getS3Url(s3Key);

  console.log(`✅ Ticket PDF generado y subido: ${publicUrl}`);
  return publicUrl;
};

module.exports = generateTicketPDF;
