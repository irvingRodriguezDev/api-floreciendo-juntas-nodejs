// controllers/eventController.js
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const { v4: uuidv4 } = require("uuid");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
// Crear un evento y generar tickets
const createEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      location,
      map,
      startDate,
      endDate,
      time,
      totalTickets,
      price,
    } = req.body;

    if (!title || !location || !startDate || !time || !totalTickets || !price) {
      return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

    // Crear evento primero sin la imagen
    const slug = slugify(title, { lower: true, strict: true });
    const event = await Event.create({
      title,
      slug,
      description,
      location,
      map,
      startDate,
      endDate,
      time,
      totalTickets,
      price, // se convertirá a centavos si usamos el setter
    });

    // Si se envió archivo, subir a S3 y actualizar
    if (req.file) {
      const s3Url = await uploadToS3("events", req.file, event.id);
      event.image = s3Url;
      await event.save();
    }

    // Generar tickets
    const tickets = [];
    for (let i = 0; i < totalTickets; i++) {
      tickets.push({
        code: uuidv4(),
        eventId: event.id,
      });
    }
    await Ticket.bulkCreate(tickets);

    res.status(201).json({ event, ticketsCreated: totalTickets });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creando el evento" });
  }
};

// Listar todos los eventos
const getEvents = async (req, res) => {
  try {
    const events = await Event.findAll({
      include: [{ model: Ticket, as: "tickets" }],
    });
    const formatted = events.map((c) => ({
      ...c.toJSON(),
      image: c.image ? getS3Url(c.image) : null,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo eventos" });
  }
};

const getLatestEvents = async (req, res) => {
  try {
    const events = await Event.findAll({
      limit: 4,
      order: [["createdAt", "DESC"]],
    });
    const formatted = events.map((c) => ({
      ...c.toJSON(),
      image: c.image ? getS3Url(c.image) : null,
    }));
    return res.status(200).json({
      success: true,
      count: formatted.length,
      events: formatted,
    });
  } catch (error) {
    console.error("Error al obtener los últimos eventos:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener los últimos eventos",
    });
  }
};

// Obtener un evento individual
const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findByPk(id, {
      include: [{ model: Ticket, as: "tickets" }],
    });
    if (!event)
      return res.status(404).json({ message: "Evento no encontrado" });
    const formattedEvent = {
      ...event.toJSON(),
      image: event.image ? getS3Url(event.image) : null,
    };
    res.json(formattedEvent);
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo evento" });
  }
};

// Comprar un ticket
const buyTicket = async (req, res) => {
  try {
    const { eventId, buyerName, buyerEmail } = req.body;

    const ticket = await Ticket.findOne({
      where: { eventId, sold: false },
    });

    if (!ticket) return res.status(400).json({ message: "Tickets agotados" });

    ticket.buyerName = buyerName;
    ticket.buyerEmail = buyerEmail;
    ticket.sold = true;
    await ticket.save();

    // Aquí podríamos emitir un evento websocket
    if (req.io) {
      req.io.emit("ticketSold", { eventId, ticketCode: ticket.code });
    }

    res.json({ message: "Ticket comprado", ticket });
  } catch (error) {
    res.status(500).json({ message: "Error comprando ticket" });
  }
};

module.exports = {
  buyTicket,
  getEventById,
  getEvents,
  createEvent,
  getLatestEvents,
};
