// utils/pdfGenerator.js
import QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";

export const generateTicketPDF = async (ticket) => {
  const qrData = `ticket:${ticket.id}`;
  const qrImage = await QRCode.toDataURL(qrData);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);

  page.drawText("Boleto de Evento", { x: 140, y: 550, size: 18 });
  page.drawText(`Ticket ID: ${ticket.id}`, { x: 50, y: 500, size: 12 });

  const qrImageBytes = Buffer.from(qrImage.split(",")[1], "base64");
  const qrEmbed = await pdf.embedPng(qrImageBytes);
  page.drawImage(qrEmbed, { x: 100, y: 300, width: 200, height: 200 });

  const pdfBytes = await pdf.save();
  const filePath = `./tickets/${ticket.id}.pdf`;
  fs.writeFileSync(filePath, pdfBytes);

  ticket.pdf_url = filePath;
  await ticket.save();

  return filePath;
};
