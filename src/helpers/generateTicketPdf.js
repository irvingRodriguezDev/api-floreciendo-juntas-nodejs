const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const { Event, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("./getS3Url");

/**
 * Genera un PDF tipo boleto con diseño moderno y QR, y lo sube a S3.
 */
const generateTicketPDF = async (ticket) => {
  const event = await Event.findByPk(ticket.eventId);
  const user = await User.findOne({
    where: { email: ticket.buyerEmail.toLowerCase() },
  });

  if (!event || !user) throw new Error("Evento o usuario no encontrado");

  // 🟢 Generar QR en memoria
  const qrBuffer = await QRCode.toBuffer(ticket.code, {
    type: "png",
    width: 250,
  });

  // 🟢 Crear documento PDF en memoria
  const doc = new PDFDocument({
    size: "A6", // Tamaño tipo ticket (105mm x 148mm)
    margin: 20,
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  // 🩶 Fondo general
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f9fafb"); // gris suave
  doc.restore();

  // 🎨 Encabezado tipo banner
  const headerHeight = 55;
  doc.save();
  doc.fillColor("#111827").rect(0, 0, doc.page.width, headerHeight).fill();

  // 🔠 Ajustar tamaño del título automáticamente
  let fontSize = 18;
  const title = event.title?.toUpperCase() || "EVENTO";
  doc.font("Helvetica-Bold");

  while (
    doc.widthOfString(title, { fontSize }) > doc.page.width - 40 &&
    fontSize > 10
  ) {
    fontSize -= 1; // reducir hasta que quepa
  }

  doc.fillColor("#fff").fontSize(fontSize);
  doc.text(title, 0, headerHeight / 2 - fontSize / 2, { align: "center" });
  doc.restore();

  // 🧾 Cuerpo del ticket
  doc.moveDown(1.5);
  doc.fillColor("#374151").font("Helvetica").fontSize(12);

  doc.text(
    `Fecha: ${
      event.startDate
        ? new Date(event.startDate).toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : "Por definir"
    }`,
    { align: "center" }
  );

  doc.moveDown(0.3);
  doc.text(`Lugar: ${event.location || "Por definir"}`, {
    align: "center",
    width: doc.page.width - 40,
  });
  doc.moveDown(0.8);

  // Línea divisora
  doc
    .moveTo(40, doc.y)
    .lineTo(doc.page.width - 40, doc.y)
    .strokeColor("#d1d5db")
    .lineWidth(1)
    .stroke();

  doc.moveDown(0.8);

  // 👤 Información del comprador (si existe)
  if (user.name) {
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#4b5563")
      .text(user.name, { align: "center" })
      .moveDown(0.5);
  }

  // --- QR centrado con marco elegante ---
  const qrSize = 150;
  const qrX = (doc.page.width - qrSize) / 2;
  const qrY = doc.y + 10;

  // Marco decorativo
  doc
    .rect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize], align: "center" });
  doc.moveDown(10);

  // Código del ticket
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text(ticket.code, { align: "center" });

  // --- Pie de página ---
  doc.moveDown(1.2);
  doc
    .font("Helvetica-Oblique")
    .fontSize(10)
    .fillColor("#6b7280")
    .text("Gracias por tu compra", { align: "center" })
    .moveDown(0.2)
    .text("Presenta este boleto en la entrada del evento", { align: "center" });

  // Línea decorativa final
  doc
    .moveTo(40, doc.page.height - 25)
    .lineTo(doc.page.width - 40, doc.page.height - 25)
    .strokeColor("#e5e7eb")
    .lineWidth(0.5)
    .stroke();

  doc.end();

  // Esperar el buffer completo
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

  return publicUrl;
};

module.exports = generateTicketPDF;
