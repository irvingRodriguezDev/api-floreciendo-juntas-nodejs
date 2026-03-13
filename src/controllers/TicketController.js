// controllers/ticketController.js
const { Ticket, Event, User } = require("../models");
const path = require("path");
const nodemailer = require("nodemailer");
const sequelize = require("../config/db");
const { Op } = require("sequelize");
const { generateCalendarLinks } = require("../helpers/generateCalendarLinks");
const getS3Url = require("../helpers/getS3Url");
const generateTicketPDF = require("../helpers/generateTicketPdf");
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // ✅ Usuario desde middleware de auth, no desde params
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const offset = (page - 1) * limit;

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
                { endDate: { [Op.gte]: new Date() } }, // si tiene endDate
                {
                  endDate: null,
                  startDate: { [Op.gte]: today }, // si no tiene endDate, usa startDate del día
                },
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
        order: [["updatedAt", "DESC"]],
        limit,
        offset,
      },
    );

    const totalPages = Math.ceil(totalTickets / limit);

    return res.status(200).json({
      tickets,
      currentPage: page,
      totalPages,
      totalTickets,
      limit,
    });
  } catch (error) {
    console.error("Error al obtener boletos del usuario:", error);
    return res
      .status(500)
      .json({ message: "Error al obtener boletos del usuario" });
  }
};

const downloadTicket = async (req, res) => {
  try {
    // 1. Usar req.params, no req.query — el ID va en la ruta /tickets/:ticketId/download
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({ message: "El ID del boleto es requerido" });
    }

    // 2. El usuario viene del middleware de autenticación, no del query
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const ticket = await Ticket.findOne({
      where: {
        id: ticketId,
        buyerEmail: user.email,
        sold: true,
      },
      include: [
        {
          model: Event,
          as: "Event",
          where: { startDate: { [Op.gte]: new Date() } }, // evento vigente
        },
      ],
    });

    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Boleto no encontrado o evento expirado" });
    }

    // 3. Lógica lazy — solo genera si no existe aún
    if (!ticket.pdfUrl) {
      const pdfUrl = await generateTicketPDF(ticket);
      await ticket.update({ pdfUrl });
    }

    // 4. Retornar URL guardada en DB
    return res.status(200).json({ downloadUrl: ticket.pdfUrl });
  } catch (error) {
    console.error("❌ Error al descargar el boleto:", error);
    return res.status(500).json({ message: "Error al descargar el boleto" });
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
      `Boleto validado: ${ticket.code} - ID: ${ticket.id} - ${ticket.scannedAt}`,
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
      `/${process.env.AWS_S3_ENVIRONMENT}/tickets/${ticket.id}`,
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
  getUserTickets,
  downloadTicket,
  validateTicket,
  generateLinks,
};
