// controllers/ticketController.js
const { Ticket, Event } = require("../models");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

// Crear sesión de pago con Stripe
exports.createStripeSession = async (req, res) => {
  try {
    const { eventId, buyerName, buyerEmail } = req.body;

    const ticket = await Ticket.findOne({ where: { eventId, sold: false } });
    if (!ticket) return res.status(400).json({ message: "Tickets agotados" });

    const event = await Event.findByPk(eventId);

    // Crear sesión Stripe usando el precio del evento
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `Ticket - ${event.title}` },
            unit_amount: event.price, // precio en centavos
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success?ticketId=${ticket.id}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      metadata: {
        ticketId: ticket.id,
        buyerName,
        buyerEmail,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creando sesión de pago" });
  }
};

// Webhook Stripe para confirmar pago
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const ticketId = session.metadata.ticketId;
    const buyerName = session.metadata.buyerName;
    const buyerEmail = session.metadata.buyerEmail;

    const ticket = await Ticket.findByPk(ticketId, { include: Event });
    ticket.sold = true;
    ticket.buyerName = buyerName;
    ticket.buyerEmail = buyerEmail;
    await ticket.save();

    await generateTicketPDF(ticket);
    await sendTicketEmail(ticket);
  }

  res.json({ received: true });
};

// Generar PDF con QR
const generateTicketPDF = async (ticket) => {
  const doc = new PDFDocument({ size: "A6", layout: "landscape" });
  const filePath = path.join(__dirname, `../tickets/${ticket.code}.pdf`);
  doc.pipe(fs.createWriteStream(filePath));

  doc
    .fontSize(20)
    .fillColor("#E53888")
    .text("Boleto Evento 🎟️", { align: "center" });
  doc.moveDown();
  doc.fontSize(14).fillColor("black").text(`Nombre: ${ticket.buyerName}`);
  doc.text(`Evento: ${ticket.Event.title}`);
  doc.text(`Fecha: ${ticket.Event.date.toLocaleDateString()}`);
  doc.text(`Hora: ${ticket.Event.time}`);
  doc.text(`Lugar: ${ticket.Event.location}`);
  doc.text(`Precio: $${(ticket.Event.price / 100).toFixed(2)} MXN`);
  doc.text(`Código: ${ticket.code}`);
  doc.text(`Estado: ${ticket.sold ? "Pagado" : "Disponible"}`);
  doc.moveDown();

  const qrData = `ticket:${ticket.code}`;
  const qrImage = await QRCode.toDataURL(qrData);
  doc.image(qrImage, { width: 100, align: "center" });

  doc.end();
};

// Enviar correo con PDF
const sendTicketEmail = async (ticket) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.mailtrap.io", // Cambiar por SMTP real
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const filePath = path.join(__dirname, `../tickets/${ticket.code}.pdf`);

  await transporter.sendMail({
    from: '"Floreciendo Juntas" <no-reply@floreciendo.com>',
    to: ticket.buyerEmail,
    subject: `Tu boleto para ${ticket.Event.title}`,
    text: "Gracias por tu compra. Adjuntamos tu boleto con QR.",
    attachments: [{ filename: `${ticket.code}.pdf`, path: filePath }],
  });
};
