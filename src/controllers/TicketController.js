// controllers/ticketController.js
const { Ticket, Event, User } = require("../models");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const sequelize = require("../config/db");
const { Op, json, literal } = require("sequelize");
const { generateCalendarLinks } = require("../helpers/generateCalendarLinks");
const getS3Url = require("../helpers/getS3Url");
// Crear sesión de pago con Stripe
const createStripeSession = async (req, res) => {
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
const stripeWebhook = async (req, res) => {
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

const getUserTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "El ID del usuario es requerido" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const today = new Date();
    const offset = (page - 1) * limit;

    // Buscar boletos vendidos del usuario, de eventos vigentes
    const { rows: tickets, count: totalTickets } = await Ticket.findAndCountAll(
      {
        where: {
          buyerEmail: user.email,
          sold: true,
        },
        include: [
          {
            model: Event,
            as: "Event",
            where: {
              [Op.or]: [
                { startDate: { [Op.gte]: today } }, // eventos que empiezan hoy o después
                { endDate: { [Op.gte]: today } }, // eventos que no han terminado
              ],
            },
            attributes: [
              "id",
              "title",
              "location",
              "startDate",
              "endDate",
              "image",
              "price",
            ],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset),
      }
    );

    if (tickets.length === 0) {
      return res
        .status(404)
        .json({ message: "No se encontraron boletos vigentes" });
    }

    const totalPages = Math.ceil(totalTickets / limit);

    res.status(200).json({
      tickets,
      currentPage: parseInt(page),
      totalPages,
      totalTickets,
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Error al obtener boletos del usuario:", error);
    res.status(500).json({ message: "Error al obtener boletos del usuario" });
  }
};

const downloadTicket = async (req, res) => {
  try {
    const { ticketId, userId } = req.query;

    if (!ticketId) {
      return res.status(400).json({ message: "El ID del boleto es requerido" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const ticket = await Ticket.findOne({
      where: { id: ticketId, buyerEmail: user.email, sold: true },
      include: [
        {
          model: Event,
          as: "event",
          where: { endDate: { [Op.gte]: new Date() } }, // evento vigente
        },
      ],
    });

    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Boleto no encontrado o evento expirado" });
    }

    // Obtener la URL del PDF desde S3
    const pdfUrl = await getS3Url(
      process.env.AWS_S3_ENVIRONMENT,
      "tickets",
      `${ticket.id}`
    );

    if (!pdfUrl) {
      return res
        .status(404)
        .json({ message: "Archivo del boleto no encontrado en S3" });
    }

    // Retornar la URL para descarga directa en el frontend
    return res.status(200).json({ downloadUrl: pdfUrl });
  } catch (error) {
    console.error("Error al descargar el boleto:", error);
    res.status(500).json({ message: "Error al descargar el boleto" });
  }
};

const validateTicket = async (req, res) => {
  try {
    const { code } = req.body;

    // return res.json(code);

    if (!code) {
      return res
        .status(400)
        .json({ status: "error", message: "El code es requerido" });
    }

    // Buscar el boleto
    const ticket = await Ticket.findOne({ where: { code } });

    if (!ticket) {
      return res
        .status(404)
        .json({ status: "error", message: "Boleto no encontrado" });
    }

    if (ticket.scanned) {
      return res.status(409).json({
        status: "error",
        message: "Boleto ya fue escaneado",
        scannedAt: ticket.scannedAt,
      });
    }

    // Marcar como escaneado con timestamp
    ticket.scanned = true;
    ticket.scannedAt = new Date();
    await ticket.save();

    // Log opcional
    console.log(
      `Boleto validado: ${ticket.code} - ID: ${ticket.id} - ${ticket.scannedAt}`
    );

    return res.status(200).json({
      status: "success",
      message: "Boleto válido",
      ticket: {
        id: ticket.id,
        code: ticket.code,
        scannedAt: ticket.scannedAt,
        buyerEmail: ticket.buyerEmail || null, // si tienes otros campos
      },
    });
  } catch (error) {
    console.error("Error validando boleto:", error);
    return res.status(500).json({
      status: "error",
      message: "Error interno del servidor",
      error: error.message,
    });
  }
};

const generateLinks = async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Buscar ticket con su evento
    const ticket = await Ticket.findByPk(ticketId, {
      include: [{ model: Event }],
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket no encontrado" });
    }

    const event = ticket.Event;

    // ✅ CORRECCIÓN: Construir ticketUrl correctamente
    const ticketUrl = getS3Url(
      `/${process.env.AWS_S3_ENVIRONMENT}/tickets/${ticket.id}`
    );

    // Generar todos los links de calendario
    const calendarLinks = generateCalendarLinks(event, ticketUrl, ticketId);

    res.json(calendarLinks);
  } catch (error) {
    console.error("Error generando links de calendario:", error);
    res.status(500).json({
      message: "Error generando links de calendario",
      error: error.message,
    });
  }
};

module.exports = {
  sendTicketEmail,
  createStripeSession,
  stripeWebhook,
  getUserTickets,
  downloadTicket,
  validateTicket,
  generateLinks,
};
