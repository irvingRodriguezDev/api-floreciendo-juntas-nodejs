// controllers/eventController.js
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const { v4: uuidv4 } = require("uuid");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const { Op, json, literal } = require("sequelize");
const stripe = require("../config/stripe");
// Crear un evento y generar tickets
const RESERVATION_MINUTES = 15;
const SEARCH_LIMIT = 50;
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
    res.set("Cache-Control", "no-store"); // evita 304

    const search = (req.query.search || "").trim();

    // Campos esenciales del evento + COUNT de tickets libres
    const eventAttributes = [
      "id",
      "title",
      "description",
      "startDate",
      "endDate",
      "location",
      "image",
      "time",
      "createdAt",
      [
        literal(`(
          SELECT COUNT(*)
          FROM Tickets t
          WHERE t.eventId = Event.id AND t.sold = 0
        )`),
        "availableTickets",
      ],
    ];

    // 🟢 Modo búsqueda sin paginación
    if (search) {
      const events = await Event.findAll({
        attributes: eventAttributes,
        where: {
          [Op.or]: [
            { title: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
            { location: { [Op.like]: `%${search}%` } },
          ],
        },
        order: [["createdAt", "DESC"]],
        limit: SEARCH_LIMIT,
      });

      const formatted = events.map((event) => ({
        ...event.toJSON(),
        image: event.image ? getS3Url(event.image) : null,
        availableTickets: parseInt(event.get("availableTickets"), 10),
      }));

      return res.json({
        total: formatted.length,
        search,
        events: formatted,
      });
    }

    // 🟢 Modo paginación normal
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await Event.findAndCountAll({
      attributes: eventAttributes,
      distinct: true,
      col: "id",
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const formatted = rows.map((event) => ({
      ...event.toJSON(),
      image: event.image ? getS3Url(event.image) : null,
      availableTickets: parseInt(event.get("availableTickets"), 10),
    }));

    return res.json({
      total: count,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      limit,
      events: formatted,
    });
  } catch (error) {
    console.error("Error obteniendo eventos:", error);
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

    // Obtener evento
    const event = await Event.findByPk(id);
    if (!event)
      return res.status(404).json({ message: "Evento no encontrado" });

    // Contar tickets disponibles
    const availableTickets = await Ticket.count({
      where: {
        eventId: event.id,
        sold: 0, // solo los que están disponibles
      },
    });

    // Formatear respuesta
    const formattedEvent = {
      ...event.toJSON(),
      image: event.image ? getS3Url(event.image) : null,
      availableTickets, // ✅ cantidad de tickets disponibles
    };

    res.json(formattedEvent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error obteniendo evento" });
  }
};

const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
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

    // 1️⃣ Buscar el evento
    const event = await Event.findByPk(id);
    if (!event) {
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // Guardamos el total de tickets anterior
    const previousTotalTickets = event.totalTickets;

    // 2️⃣ Actualizar campos
    if (title) {
      event.title = title;
      event.slug = slugify(title, { lower: true, strict: true });
    }
    if (description !== undefined) event.description = description;
    if (location) event.location = location;
    if (map !== undefined) event.map = map;
    if (startDate) event.startDate = startDate;
    if (endDate !== undefined) event.endDate = endDate;
    if (time) event.time = time;
    if (totalTickets !== undefined) event.totalTickets = totalTickets;
    if (price !== undefined) event.price = price;

    // 3️⃣ Si se envía nueva imagen, subir a S3
    if (req.file) {
      const s3Url = await uploadToS3("events", req.file, event.id);
      event.image = s3Url;
    }

    // 4️⃣ Guardar cambios antes de manejar tickets
    await event.save();

    // 5️⃣ Ajustar tickets
    if (totalTickets !== undefined && totalTickets !== previousTotalTickets) {
      if (totalTickets > previousTotalTickets) {
        // Crear tickets nuevos
        const ticketsToCreate = totalTickets - previousTotalTickets;
        const newTickets = [];
        for (let i = 0; i < ticketsToCreate; i++) {
          newTickets.push({
            code: uuidv4(),
            eventId: event.id,
          });
        }
        await Ticket.bulkCreate(newTickets);
      } else {
        // Reducir tickets disponibles (solo los que no han sido vendidos)
        const ticketsToDelete = previousTotalTickets - totalTickets;
        const unsoldTickets = await Ticket.findAll({
          where: { eventId: event.id, sold: 0 },
          order: [["createdAt", "DESC"]],
          limit: ticketsToDelete,
        });
        const idsToDelete = unsoldTickets.map((t) => t.id);
        if (idsToDelete.length > 0) {
          await Ticket.destroy({ where: { id: idsToDelete } });
        }
      }
    }

    res.status(200).json({
      message: "Evento actualizado correctamente",
      event,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando el evento" });
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
      cancel_url: `${process.env.CLIENT_URL}/error`,
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

const getSimilarEvents = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Obtener el evento principal
    const mainEvent = await Event.findByPk(id);
    if (!mainEvent) {
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // 2️⃣ Buscar 3 eventos similares (mismo location, distinto id)
    const similarEvents = await Event.findAll({
      where: {
        id: { [Op.ne]: mainEvent.id }, // distinto evento
        location: mainEvent.location, // mismo lugar
      },
      limit: 3,
      order: [["createdAt", "DESC"]],
    });

    // 3️⃣ Formatear imágenes S3
    const formatted = similarEvents.map((event) => ({
      ...event.toJSON(),
      image: event.image ? getS3Url(event.image) : null,
    }));

    res.json({
      mainEvent: {
        id: mainEvent.id,
        title: mainEvent.title,
        location: mainEvent.location,
        image: mainEvent.image ? getS3Url(mainEvent.image) : null,
      },
      similarEvents: formatted,
    });
  } catch (error) {
    console.error("Error obteniendo eventos similares:", error);
    res.status(500).json({ message: "Error obteniendo eventos similares" });
  }
};

module.exports = {
  buyTicket,
  getEventById,
  getEvents,
  createEvent,
  getLatestEvents,
  getSimilarEvents,
  updateEvent,
};
