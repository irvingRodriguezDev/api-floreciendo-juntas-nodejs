// controllers/eventController.js
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const { v4: uuidv4 } = require("uuid");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const { Op, json } = require("sequelize");
const stripe = require("../config/stripe");
// Crear un evento y generar tickets
const RESERVATION_MINUTES = 15;
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
  const t = await sequelize.transaction();
  try {
    const { eventId, buyerName, buyerEmail } = req.body;
    if (!eventId || !buyerName || !buyerEmail) {
      await t.rollback();
      return res.status(400).json({ message: "Faltan campos requeridos" });
    }

    // Buscar el evento para obtener el precio
    const event = await Event.findByPk(eventId, { transaction: t });

    if (!event) {
      await t.rollback();
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // Buscar un ticket no vendido y no reservado (y que no tenga reserva expirada)
    // Bloqueamos la fila con FOR UPDATE para evitar race conditions
    const now = new Date();
    const ticket = await Ticket.findOne({
      where: {
        eventId,
        sold: false,
        // Reservado false OR reservation expired
        [Op.or]: [
          { reserved: false },
          { reservation_expires_at: { [Op.lt]: now } },
          { reservation_expires_at: null },
        ],
      },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!ticket) {
      await t.rollback();
      return res.status(400).json({ message: "Tickets agotados" });
    }

    // Reservar el ticket temporalmente
    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);
    ticket.reserved = true;
    ticket.reservation_expires_at = expiresAt;
    ticket.buyerName = buyerName; // opcional, para mostrar en admin
    ticket.buyerEmail = buyerEmail;
    await ticket.save({ transaction: t });

    // Crear sesión de Stripe (usamos el precio del evento en centavos)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: {
              name: `Boleto - ${event.title}`,
              description: event.description || "",
            },
            unit_amount: event.price * 100, // event.price en centavos
          },
          quantity: 1,
        },
      ],
      metadata: {
        ticketId: ticket.id,
        eventId,
        buyerName,
        buyerEmail,
      },
      success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    // Commit de la transacción — la reserva quedó persistida
    await t.commit();

    // Devuelve la url de checkout para redirigir al cliente
    return res.status(200).json({ url: session.url, expiresAt });
  } catch (error) {
    console.error("Error en buyTicket:", error);
    try {
      await t.rollback();
    } catch (rerr) {
      console.error("Error al hacer rollback:", rerr);
    }
    return res.status(500).json({ message: "Error creando la sesión de pago" });
  }
};

module.exports = {
  buyTicket,
  getEventById,
  getEvents,
  createEvent,
  getLatestEvents,
};
