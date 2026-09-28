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
const moment = require("moment-timezone");
const { generateICSFile } = require("../helpers/generateCalendarLinks");
const {
  User,
  Notifications,
  NotificationToken,
  Booking,
} = require("../models");
const {
  sendPushNotificationMulticast,
} = require("../services/sendPushNotification");
const emitNotification = require("../helpers/emitNotification");
const PaymentTicket = require("../models/PaymentTicket");
// Crear un evento y generar tickets
const RESERVATION_MINUTES = 15;
const SEARCH_LIMIT = 50;
const createEvent = async (req, res) => {
  // Iniciar transacción
  const t = await sequelize.transaction();

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
      await t.rollback();
      return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

    // Crear fecha en zona horaria de México
    const startDateTime = moment
      .tz(`${startDate} ${time}`, "YYYY-MM-DD HH:mm", "America/Mexico_City")
      .toDate();

    let endDateTime = null;
    if (endDate) {
      endDateTime = moment
        .tz(`${endDate} ${time}`, "YYYY-MM-DD HH:mm", "America/Mexico_City")
        .toDate();
    }

    // Crear evento dentro de la transacción
    const slug = slugify(title, { lower: true, strict: true });
    const event = await Event.create(
      {
        title,
        slug,
        description,
        location,
        map,
        startDate: startDateTime,
        endDate: endDateTime,
        time,
        totalTickets,
        price,
      },
      { transaction: t },
    );

    // Si se envió archivo, subir a S3 ANTES de crear tickets
    if (req.file) {
      try {
        const s3Url = await uploadToS3("events", req.file, event.id);
        event.image = s3Url;
        await event.save({ transaction: t });
      } catch (s3Error) {
        console.error("Error subiendo a S3:", s3Error);
        await t.rollback();
        return res.status(500).json({
          message: "Error subiendo la imagen a S3",
          error: s3Error.message,
        });
      }
    }

    // Generar tickets dentro de la transacción
    const tickets = [];
    for (let i = 0; i < totalTickets; i++) {
      tickets.push({
        code: uuidv4(),
        eventId: event.id,
        paymentStatus: "AVAILABLE", // Inicialmente disponibles
      });
    }
    await Ticket.bulkCreate(tickets, { transaction: t });

    // ✅ Si todo salió bien, confirmar la transacción
    await t.commit();

    res.status(201).json({
      event,
      ticketsCreated: totalTickets,
    });
    // async () => {
    //   try {
    //     const usersWithTokens = await User.findAll({
    //       where: { roleId: 4, isSubscribed: true },
    //       attributes: ["id"],
    //       include: [
    //         {
    //           model: NotificationToken,
    //           as: "NotificationTokens",
    //           where: { isActive: true, device: { [Op.ne]: "safari" } },
    //           attributes: ["token"],
    //           required: false,
    //         },
    //       ],
    //     });
    //     if (usersWithTokens.length > 0) {
    //       const notifTitle = "Nuevo evento públicado";
    //       const notifBody = `${event.name} se ha publicado`;
    //       const notifUrl = `/detalle-evento/${event.id}`;

    //       // 1. Crear las notificaciones en la DB
    //       const createdNotifications = await Notifications.bulkCreate(
    //         usersWithTokens.map((u) => ({
    //           userId: u.id,
    //           actorId: null,
    //           type: "post",
    //           entityId: event.id,
    //           title: notifTitle,
    //           body: notifBody,
    //           url: notifUrl,
    //           data: { eventId: event.id },
    //         })),
    //         { returning: true }, // 💡 Importante para obtener los objetos creados
    //       );

    //       // 🔥 2. EMITIR POR SOCKET A CADA USUARIO CONECTADO
    //       // Como es una comunidad, notificamos a todos los usuarios de la lista
    //       createdNotifications.forEach((notif) => {
    //         emitNotification(notif.userId, notif);
    //       });

    //       // 3. Recolectar tokens para Push (Firebase)
    //       const allTokens = usersWithTokens.flatMap((u) =>
    //         (u.NotificationTokens || []).map((t) => t.token),
    //       );

    //       if (allTokens.length > 0) {
    //         for (let i = 0; i < allTokens.length; i += 500) {
    //           const batch = allTokens.slice(i, i + 500);
    //           await sendPushNotificationMulticast({
    //             tokens: batch,
    //             title: notifTitle,
    //             body: notifBody,
    //             data: {
    //               type: "event",
    //               eventId: String(event.id),
    //               url: notifUrl,
    //             },
    //           }).catch(() => {});
    //         }
    //       }
    //     }
    //   } catch (err) {
    //     console.error("❌ Error en Notificaciones evento:", err);
    //   }
    // };
  } catch (error) {
    // ❌ Si algo falla, revertir TODO
    await t.rollback();
    console.error("Error creando evento:", error);
    res.status(500).json({
      message: "Error creando el evento",
      error: error.message,
    });
  }
};
// Listar todos los eventos

const getEvents = async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    // Fecha actual sin horas para evitar falsos vencidos
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      "price",
      "slug",
      [
        literal(`(
          SELECT COUNT(*)
          FROM Tickets t
          WHERE t.eventId = Event.id AND t.sold = 0
        )`),
        "availableTickets",
      ],
    ];

    // ✅ Modo búsqueda
    if (search) {
      const events = await Event.findAll({
        attributes: eventAttributes,
        where: {
          startDate: { [Op.gte]: today }, // ✅ Solo vigentes
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
        image: getS3Url(event.image) ?? null,
        availableTickets: parseInt(event.get("availableTickets"), 10),
      }));

      return res.json({
        total: formatted.length,
        search,
        events: formatted,
      });
    }

    // ✅ Modo paginado normal
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await Event.findAndCountAll({
      attributes: eventAttributes,
      where: {
        startDate: { [Op.gte]: today }, // ✅ Solo vigentes
      },
      distinct: true,
      col: "id",
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const formatted = rows.map((event) => ({
      ...event.toJSON(),
      image: getS3Url(event.image) || null,
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const events = await Event.findAll({
      where: {
        startDate: { [Op.gte]: today }, // ✅ Solo eventos vigentes
      },
      limit: 4,
      order: [["createdAt", "DESC"]],
    });

    const formatted = events.map((e) => ({
      ...e.toJSON(),
      image: getS3Url(e.image) || null,
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
    const { slug } = req.params;

    // Obtener evento
    const event = await Event.findOne({
      slug,
    });
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
  const t = await sequelize.transaction();

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

    // Buscar el evento
    const event = await Event.findByPk(id, { transaction: t });
    if (!event) {
      await t.rollback();
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    const previousTotalTickets = event.totalTickets;

    // Actualizar campos
    if (title) {
      event.title = title;
      event.slug = slugify(title, { lower: true, strict: true });
    }
    if (description !== undefined) event.description = description;
    if (location) event.location = location;
    if (map !== undefined) event.map = map;

    if (startDate) {
      const timeToUse = time || event.time || "00:00";
      event.startDate = moment
        .tz(
          `${startDate} ${timeToUse}`,
          "YYYY-MM-DD HH:mm",
          "America/Mexico_City",
        )
        .toDate();
    }

    if (endDate !== undefined) {
      if (endDate) {
        const timeToUse = time || event.time || "00:00";
        event.endDate = moment
          .tz(
            `${endDate} ${timeToUse}`,
            "YYYY-MM-DD HH:mm",
            "America/Mexico_City",
          )
          .toDate();
      } else {
        event.endDate = null;
      }
    }

    if (time) event.time = time;
    if (totalTickets !== undefined) event.totalTickets = totalTickets;
    if (price !== undefined) event.price = price;

    // Si se envía nueva imagen, subir a S3
    if (req.file) {
      try {
        const s3Url = await uploadToS3("events", req.file, event.id);
        event.image = s3Url;
      } catch (s3Error) {
        console.error("Error subiendo a S3:", s3Error);
        await t.rollback();
        return res.status(500).json({
          message: "Error subiendo la imagen a S3",
          error: s3Error.message,
        });
      }
    }

    // Guardar cambios
    await event.save({ transaction: t });

    // Ajustar tickets
    if (totalTickets !== undefined && totalTickets !== previousTotalTickets) {
      if (totalTickets > previousTotalTickets) {
        const ticketsToCreate = totalTickets - previousTotalTickets;
        const newTickets = [];
        for (let i = 0; i < ticketsToCreate; i++) {
          newTickets.push({
            code: uuidv4(),
            eventId: event.id,
          });
        }
        await Ticket.bulkCreate(newTickets, { transaction: t });
      } else {
        const ticketsToDelete = previousTotalTickets - totalTickets;
        const unsoldTickets = await Ticket.findAll({
          where: { eventId: event.id, sold: 0 },
          order: [["createdAt", "DESC"]],
          limit: ticketsToDelete,
          transaction: t,
        });
        const idsToDelete = unsoldTickets.map((t) => t.id);
        if (idsToDelete.length > 0) {
          await Ticket.destroy({
            where: { id: idsToDelete },
            transaction: t,
          });
        }
      }
    }

    // Confirmar transacción
    await t.commit();

    res.status(200).json({
      message: "Evento actualizado correctamente",
      event,
    });
  } catch (error) {
    await t.rollback();
    console.error("Error actualizando evento:", error);
    res.status(500).json({
      message: "Error actualizando el evento",
      error: error.message,
    });
  }
};

// Comprar tickets
const buyTicket = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { eventId, buyerName, buyerEmail, quantity = 1 } = req.body;

    // Validar campos requeridos
    if (!eventId || !buyerName || !buyerEmail) {
      await t.rollback();
      return res.status(400).json({ message: "Faltan campos requeridos" });
    }

    // Validar quantity
    if (quantity < 1 || quantity > 50) {
      await t.rollback();
      return res.status(400).json({ message: "Cantidad inválida (1-50)" });
    }

    // Buscar el evento
    const event = await Event.findByPk(eventId, { transaction: t });

    if (!event) {
      await t.rollback();
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // Buscar N boletos disponibles (no vendidos, no reservados o con reserva expirada)
    const now = new Date();
    const tickets = await Ticket.findAll({
      where: {
        eventId,
        sold: false,
        [Op.or]: [
          { reserved: false },
          { reservation_expires_at: { [Op.lt]: now } },
          { reservation_expires_at: null },
        ],
      },
      order: [["id", "ASC"]], // 🔑 Orden secuencial para boletos consecutivos
      limit: quantity,
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    // ¿Hay suficientes boletos?
    if (tickets.length < quantity) {
      await t.rollback();
      return res.status(400).json({
        message:
          tickets.length === 0
            ? "Tickets agotados"
            : `Solo quedan ${tickets.length} boleto(s) disponibles`,
      });
    }

    // Reservar todos los boletos
    const expirationMinutes = Math.max(RESERVATION_MINUTES || 30, 30);
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    await Promise.all(
      tickets.map((ticket) =>
        ticket.update(
          {
            reserved: true,
            reservation_expires_at: expiresAt,
            buyerName,
            buyerEmail,
          },
          { transaction: t },
        ),
      ),
    );

    // IDs como string separado por comas para la metadata de Stripe
    const ticketIds = tickets.map((t) => t.id).join(",");
    const firstTicket = tickets[0].id;
    // Crear sesión de Stripe
    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: {
              name: `${quantity} boleto(s) — ${event.title}`,
              description:
                quantity > 1
                  ? `${quantity} boletos para ${event.title}`
                  : `Boleto #${firstTicket}`,
            },
            unit_amount: event.price * 100, // precio unitario en centavos
          },
          quantity, // 🔑 Stripe multiplica el precio automáticamente
        },
      ],

      payment_intent_data: {
        metadata: {
          flow: "VENTA_TICKET",
          eventId: String(eventId),
          ticketIds, // "101,102,103"
          quantity: String(quantity),
          buyerName,
          buyerEmail,
          origin: "AUTH", // Indica que es una compra con usuario autenticado
        },
      },

      metadata: {
        flow: "VENTA_TICKET",
        eventId: String(eventId),
        ticketIds, // "101,102,103"
        quantity: String(quantity),
        buyerName,
        buyerEmail,
        origin: "AUTH", // Indica que es una compra con usuario autenticado
      },

      customer_email: buyerEmail,
      expires_at: Math.floor(expiresAt.getTime() / 1000),

      success_url: `${process.env.CLIENT_URL}/success-payment-tickets?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/error`,
    });

    await t.commit();

    return res.status(200).json({
      url: session.url,
      expiresAt,
      sessionId: session.id,
      ticketIds: tickets.map((t) => t.id), // útil para el frontend
      quantity,
    });
  } catch (error) {
    console.error("Error en buyTicket:", error);
    try {
      await t.rollback();
    } catch (rollbackError) {
      console.error("Error al hacer rollback:", rollbackError);
    }
    return res.status(500).json({
      message: "Error creando la sesión de pago",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const buyTicketOpen = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      eventId,
      buyerName,
      buyerEmail,
      buyerPhone,
      quantity = 1,
      paymentType = "FULL", // "FULL" o "DEPOSIT"
      metodoPago, // "STRIPE_CARD", "STRIPE_OXXO", "BANK_TRANSFER"
    } = req.body;

    // 1. Validaciones iniciales de entrada
    if (!eventId || !buyerName || !buyerEmail || !metodoPago) {
      await t.rollback();
      return res.status(400).json({ message: "Faltan campos requeridos." });
    }

    const validMethods = ["STRIPE_CARD", "STRIPE_OXXO", "BANK_TRANSFER"];
    if (!validMethods.includes(metodoPago)) {
      await t.rollback();
      return res.status(400).json({ message: "Método de pago no válido." });
    }

    const now = new Date();

    // 2. EVITAR RESERVAS DUPLICADAS (Validación de reserva PENDING activa)
    const existingActiveBooking = await Booking.findOne({
      where: {
        buyerEmail,
        status: "PENDING",
        approvalStatus: { [Op.or]: ["PENDING_REVIEW", "APPROVED"] },
        dueDate: { [Op.gt]: now },
      },
      transaction: t,
    });

    if (existingActiveBooking) {
      await t.rollback();
      return res.status(400).json({
        code: "ACTIVE_RESERVATION_EXISTS",
        message: `Ya cuentas con una reserva activa con el folio ${existingActiveBooking.folio}. Complétala o espera a que expire.`,
        folio: existingActiveBooking.folio,
        checkoutUrl: existingActiveBooking.checkoutUrl || null,
      });
    }

    // 3. Tiempos de Expiración (dueDate) de la reserva
    const reservationHours = 24;
    const expiresAt = new Date(
      now.getTime() + reservationHours * 60 * 60 * 1000,
    );

    // 4. Validar Evento y Disponibilidad de Boletos
    const event = await Event.findByPk(eventId, { transaction: t });
    if (!event) {
      await t.rollback();
      return res.status(404).json({ message: "Evento no encontrado." });
    }

    const tickets = await Ticket.findAll({
      where: {
        eventId,
        sold: false,
        paymentStatus: "AVAILABLE",
        [Op.or]: [
          { reserved: false },
          { reservation_expires_at: { [Op.lt]: now } },
          { reservation_expires_at: null },
        ],
      },
      order: [["id", "ASC"]],
      limit: quantity,
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (tickets.length < quantity) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "No hay suficientes boletos disponibles." });
    }

    // 5. Cálculo de Montos
    const totalAmountCentavos = Math.round(event.price * 100) * quantity;
    const isDeposit = paymentType === "DEPOSIT";
    // 60% para apartado o 100% para pago completo
    const amountToChargeCentavos = isDeposit
      ? Math.round(totalAmountCentavos * 0.6)
      : totalAmountCentavos;
    const pendingAmountCentavos = totalAmountCentavos - amountToChargeCentavos;

    // Generar Folio Único
    const folio = `RES-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // 6. Crear Registro de Reserva en Base de Datos
    const booking = await Booking.create(
      {
        folio,
        buyerName,
        buyerEmail,
        buyerPhone,
        totalAmount: totalAmountCentavos / 100,
        paidAmount: 0,
        pendingAmount: pendingAmountCentavos / 100,
        paymentType: isDeposit ? "DEPOSIT" : "FULL",
        paymentMethod: metodoPago,
        approvalStatus:
          metodoPago === "BANK_TRANSFER" ? "PENDING_REVIEW" : "APPROVED",
        status: "PENDING",
        dueDate: expiresAt,
      },
      { transaction: t },
    );

    // 7. Registro Inicial en PaymentTicket (Cobro Pendiente)
    const pagoTicket = await PaymentTicket.create(
      {
        bookingId: booking.id,
        amount: amountToChargeCentavos / 100,
        paymentMethod: metodoPago,
        transactionRef: null,
        status: "PENDING",
        notes: isDeposit
          ? "Cobro inicial de Apartado"
          : "Cobro Total de Reserva",
      },
      { transaction: t },
    );

    // 8. Reservar y Bloquear los Boletos
    const ticketIds = tickets.map((tk) => tk.id);
    await Ticket.update(
      {
        reserved: true,
        reservation_expires_at: expiresAt,
        buyerName,
        buyerEmail,
        buyerPhone,
        bookingId: booking.id,
        paymentStatus: "PENDING_PAYMENT",
      },
      { where: { id: ticketIds }, transaction: t },
    );

    // Guardar los cambios en la base de datos para obtener el ID final
    await t.commit();

    // ------------------------------------------------------------------
    // 9. Integración con Stripe Checkout (Post-Commit)
    // ------------------------------------------------------------------
    let checkoutUrl = null;
    let stripeSessionId = null;

    if (["STRIPE_CARD", "STRIPE_OXXO"].includes(metodoPago)) {
      const stripeMethod = metodoPago === "STRIPE_CARD" ? ["card"] : ["oxxo"];
      const stripeExpiresAt = Math.floor(expiresAt.getTime() / 1000);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: stripeMethod,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "mxn",
              product_data: {
                name: `${isDeposit ? "Apartado (60%)" : "Pago Total"} — ${event.title}`,
                description: `Folio: ${folio}`,
              },
              unit_amount: amountToChargeCentavos,
            },
            quantity: 1,
          },
        ],
        expires_at: stripeExpiresAt,
        payment_method_options: {
          oxxo: {
            // Garantiza que la ficha expire en el tiempo asignado
            expires_after_days: 1, // (1 día = 24 hrs)
          },
        },
        // Metadata disponible dentro del objeto Checkout Session
        metadata: {
          bookingId: booking.id.toString(),
          folio,
          paymentType,
          metodoPago,
          flow: "VENTA_TICKET",
          eventDate: event.startDate,
          paymentTicketId: pagoTicket.id,
          eventTitle: event.title,
        },
        // Metadata propagada hacia el PaymentIntent resultante
        payment_intent_data: {
          metadata: {
            bookingId: booking.id.toString(),
            folio,
            paymentType,
            metodoPago,
            flow: "VENTA_TICKET",
            eventDate: event.startDate,
            paymentTicketId: pagoTicket.id,
            eventTitle: event.title,
          },
        },
        customer_email: buyerEmail,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/payment-success?session_id={CHECKOUT_SESSION_ID}&folio=${folio}&paymentType=${paymentType}&metodoPago=${metodoPago}`,
        cancel_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/payment-error`,
      });

      checkoutUrl = session.url;
      stripeSessionId = session.id;

      // Actualizar la reserva creada con la URL de Checkout para consultas futuras
      await booking.update({ checkoutUrl });
    }

    // 10. Respuesta Final
    return res.status(200).json({
      success: true,
      message: "Reserva creada exitosamente",
      bookingId: booking.id,
      folio,
      paymentMethod: metodoPago,
      expiresAt: booking.dueDate,
      amountToPay: amountToChargeCentavos / 100,
      pendingAmount: pendingAmountCentavos / 100,
      checkoutUrl,
      stripeSessionId,
    });
  } catch (error) {
    // Garantizar rollback solo si la transacción aún está abierta
    if (!t.finished) {
      await t.rollback();
    }
    console.error("💥 Error en buyTicketOpen:", error);
    return res
      .status(500)
      .json({ message: "Error procesando la solicitud de compra." });
  }
};

const getSimilarEvents = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Obtener evento principal
    const mainEvent = await Event.findByPk(id);
    if (!mainEvent) {
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // 2️⃣ Fecha actual sin horas (evita falsos expirados)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 3️⃣ Buscar eventos similares vigentes
    const similarEvents = await Event.findAll({
      where: {
        id: { [Op.ne]: mainEvent.id }, // distinto evento
        location: mainEvent.location, // mismo lugar
        startDate: { [Op.gte]: today }, // ✅ solo vigentes
      },
      limit: 3,
      order: [["createdAt", "DESC"]],
    });

    // 4️⃣ Formatear imágenes
    const formatted = similarEvents.map((event) => ({
      ...event.toJSON(),
      image: event.image ? getS3Url(event.image) : null,
    }));

    return res.json({
      mainEvent: {
        id: mainEvent.id,
        title: mainEvent.title,
        location: mainEvent.location,
        image: mainEvent.image || null,
      },
      similarEvents: formatted,
    });
  } catch (error) {
    console.error("Error obteniendo eventos similares:", error);
    return res.status(500).json({
      message: "Error obteniendo eventos similares",
    });
  }
};

const downloadIcsFile = async (req, res) => {
  try {
    const { eventId, ticketId } = req.params;

    // Buscar el evento
    const event = await Event.findByPk(eventId);

    if (!event) {
      return res.status(404).json({ message: "Evento no encontrado" });
    }

    // Generar contenido del archivo .ics
    const ticketUrl = getS3Url(
      `${process.env.AWS_S3_ENVIRONMENT}/tickets/${ticketId}`,
    );
    const icsContent = generateICSFile(event, ticketUrl, ticketId);

    // Configurar headers para descarga
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${event.slug}.ics"`,
    );

    // Enviar el contenido
    res.send(icsContent);
  } catch (error) {
    console.error("Error generando archivo ICS:", error);
    res.status(500).json({
      message: "Error generando archivo de calendario",
      error: error.message,
    });
  }
};

const topEventsSales = async (req, res) => {
  try {
    const events = await Event.findAll({
      attributes: [
        "id",
        "title",
        [
          // Contamos los boletos vendidos (usa el alias 'tickets' y la columna correcta)
          Event.sequelize.fn("COUNT", Event.sequelize.col("tickets.id")),
          "tickets_sold",
        ],
      ],
      include: [
        {
          model: Ticket,
          as: "tickets", // alias correcto
          attributes: [],
          where: { sold: true }, // solo tickets vendidos
          required: true, // solo eventos con ventas
        },
      ],
      group: ["Event.id", "Event.title"], // agrupa correctamente
      order: [[Event.sequelize.literal("tickets_sold"), "DESC"]],
      limit: 3,
      subQuery: false, // evita el error de referencia en subconsultas
    });

    return res.status(200).json({
      ok: true,
      message: "Top 3 eventos con más tickets vendidos",
      data: events,
    });
  } catch (error) {
    console.error("❌ Error al consultar los eventos con más ventas:", error);
    return res.status(500).json({
      ok: false,
      message: "Error al consultar los eventos con más ventas",
      error: error.message,
    });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findByPk(id);
    if (!event) return res.status(404).json({ msg: "evento no encontrado" });

    await event.destroy(); // o soft delete usando isActive = false

    return res.json({ msg: "Evento eliminado" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al eliminar el evento" });
  }
};

//funcion que nos permitira subir el comprobante para los pagos en transferencias
const uploadTransferProof = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { folio } = req.body;

    if (!folio) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "El folio de reserva es requerido" });
    }

    if (!req.file) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "Es necesario adjuntar el comprobante de pago" });
    }

    // 1. Subir la imagen a AWS S3
    let proofUrl = null;
    try {
      proofUrl = await uploadToS3("events/bookings", req.file, folio);
    } catch (err) {
      console.error("Error subiendo a S3:", err);
      await t.rollback();
      return res
        .status(500)
        .json({ message: "Ocurrió un problema al guardar el comprobante" });
    }

    // 2. Buscar la Reserva e incluir sus tickets y pagos
    const booking = await Booking.findOne({
      where: { folio },
      include: [
        { model: Ticket, as: "tickets" },
        { model: PaymentTicket, as: "paymentsHistory" },
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!booking) {
      await t.rollback();
      return res
        .status(404)
        .json({ message: "Reserva no encontrada con el folio proporcionado" });
    }

    // 3. Validar que la reserva acepte comprobantes
    if (booking.paymentMethod !== "BANK_TRANSFER") {
      await t.rollback();
      return res.status(400).json({
        message:
          "Esta reserva no fue generada para pago por transferencia bancaria",
      });
    }

    // 4. Validar tiempo límite si la reserva aún está PENDING y sin liquidar
    const now = new Date();
    if (
      booking.dueDate &&
      new Date(booking.dueDate) < now &&
      booking.status === "PENDING"
    ) {
      await t.rollback();
      return res.status(410).json({
        message:
          "El tiempo para subir tu comprobante ha expirado. Contacta a soporte.",
      });
    }

    if (booking.status === "COMPLETED") {
      await t.rollback();
      return res.status(400).json({
        message: "Esta reserva ya se encuentra liquidada en su totalidad",
      });
    }

    // 5. UBICAR O CREAR EL REGISTRO EN PaymentTicket
    // Buscamos si existe un ticket de pago en estado PENDING para asociar el comprobante
    let paymentTicket = await PaymentTicket.findOne({
      where: {
        bookingId: booking.id,
        status: "PENDING",
      },
      order: [["id", "DESC"]],
      transaction: t,
    });

    if (paymentTicket) {
      // Actualizamos el pago pendiente con la URL del comprobante
      await paymentTicket.update(
        {
          proofOfPaymentUrl: proofUrl,
          paidAt: now,
          notes: "Comprobante cargado por el cliente - En revisión",
        },
        { transaction: t },
      );
    } else {
      // Si por alguna razón no existía la fila PENDING (por ejemplo, liquidación posterior del 50% restante), la creamos:
      const amountToCharge = Math.round(
        (booking.pendingAmount > 0
          ? booking.pendingAmount
          : booking.totalAmount) * 100,
      );

      paymentTicket = await PaymentTicket.create(
        {
          bookingId: booking.id,
          amount: amountToCharge,
          paymentMethod: "BANK_TRANSFER",
          status: "PENDING",
          proofUrl,
          paidAt: now,
          notes: "Comprobante de liquidación cargado - En revisión",
        },
        { transaction: t },
      );
    }

    // 6. Actualizar el Booking a PENDING_REVIEW
    await booking.update(
      {
        approvalStatus: "PENDING_REVIEW",
      },
      { transaction: t },
    );

    // 7. Extender retención de boletos para dar tiempo de revisión al Administrador
    const reviewExtension = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (booking.tickets && booking.tickets.length > 0) {
      const ticketIds = booking.tickets.map((tk) => tk.id);
      await Ticket.update(
        { reservation_expires_at: reviewExtension },
        { where: { id: ticketIds }, transaction: t },
      );
    }

    await t.commit();

    return res.status(200).json({
      success: true,
      message:
        "Comprobante recibido con éxito. Tu pago está en proceso de validación.",
      folio: booking.folio,
      approvalStatus: "PENDING_REVIEW",
      paymentTicketId: paymentTicket.id,
      proofUrl,
    });
  } catch (error) {
    console.error("Error en uploadTransferProof:", error);
    try {
      await t.rollback();
    } catch (rbErr) {}

    return res.status(500).json({
      message: "Error al registrar el comprobante de pago",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
//funcion que nos permitira hacer la busqueda de la reserva por folio
const getBookingByFolio = async (req, res) => {
  try {
    const { folio } = req.params;

    if (!folio) {
      return res
        .status(400)
        .json({ message: "El folio de reserva es requerido" });
    }

    // Buscar la reserva por folio con sus boletos, pagos e historial
    const booking = await Booking.findOne({
      where: { folio: folio.trim().toUpperCase() },
      include: [
        {
          model: Ticket,
          as: "tickets",
          attributes: [
            "id",
            "code",
            "sold",
            "scanned",
            "paymentStatus",
            "pdfUrl",
          ],
          include: [
            {
              model: Event,
              attributes: [
                "id",
                "title",
                "location",
                "startDate",
                "time",
                "image",
              ],
            },
          ],
        },
        {
          model: PaymentTicket,
          as: "paymentsHistory",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "transactionRef",
            "proofOfPaymentUrl", // 👈 Se agrega la URL del comprobante
            "status",
            "paidAt",
            "notes",
            "createdAt",
          ],
        },
      ],
      order: [[{ model: PaymentTicket, as: "paymentsHistory" }, "id", "ASC"]],
    });

    if (!booking) {
      return res.status(404).json({
        message: "No se encontró ninguna reserva asociada a este folio",
      });
    }

    // Verificar si la reserva caducó (en caso de que esté PENDING y haya pasado la fecha límite)
    const now = new Date();
    const isExpired =
      booking.status === "PENDING" &&
      booking.dueDate &&
      new Date(booking.dueDate) < now &&
      booking.approvalStatus !== "PENDING_REVIEW"; // Si está en revisión del admin no se marca como expirado

    // Obtener el comprobante más reciente del historial para conveniencia del Frontend
    const latestProofUrl =
      booking.paymentsHistory && booking.paymentsHistory.length > 0
        ? [...booking.paymentsHistory].reverse().find((p) => p.proofUrl)
            ?.proofUrl || null
        : null;

    return res.status(200).json({
      folio: booking.folio,
      buyerName: booking.buyerName,
      buyerEmail: booking.buyerEmail,
      buyerPhone: booking.buyerPhone,
      financials: {
        totalAmount: booking.totalAmount,
        paidAmount: booking.paidAmount,
        pendingAmount: booking.pendingAmount,
        paymentType: booking.paymentType, // "FULL" o "DEPOSIT"
      },
      status: isExpired ? "EXPIRED" : booking.status,
      paymentMethod: booking.paymentMethod,
      approvalStatus: booking.approvalStatus, // "APPROVED", "PENDING_REVIEW", "REJECTED"
      proofOfPaymentUrl: latestProofUrl, // 👈 Extraído dinámicamente de PaymentTicket
      dueDate: booking.dueDate,
      checkoutUrl: booking.checkoutUrl || null,
      isExpired,
      ticketsCount: booking.tickets ? booking.tickets.length : 0,
      tickets: booking.tickets,
      paymentsHistory: booking.paymentsHistory, // 👈 Corregido (antes decia booking.payments)
    });
  } catch (error) {
    console.error("Error en getBookingByFolio:", error);
    return res.status(500).json({
      message: "Error al consultar la reserva por folio",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getTicketsBookByEventId = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({ message: "El ID del evento es requerido" });
    }

    // Buscar tickets asociados al evento
    const tickets = await Ticket.findAll({
      where: { eventId, bookingId: { [Op.ne]: null } }, // Solo tickets con bookingId no nulo
      attributes: [
        "id",
        "buyerName",
        "BuyerEmail",
        "BuyerPhone",
        "code",
        "sold",
        "scanned",
        "paymentStatus",
        "bookingId",
      ],
      include: [
        {
          model: Booking,
          attributes: [
            "id",
            "folio",
            "status",
            "totalAmount",
            "paidAmount",
            "pendingAmount",
            "paymentType",
            "approvalStatus",
          ],
          include: [
            {
              model: PaymentTicket,
              as: "paymentsHistory",
              attributes: [
                "id",
                "amount",
                "paymentMethod",
                "transactionRef",
                "proofOfPaymentUrl",
                "status",
                "paidAt",
                "notes",
                "createdAt",
              ],
            },
          ],
        },
      ],
    });

    if (!tickets || tickets.length === 0) {
      return res.status(404).json({
        message: "No se encontraron tickets asociados a este evento",
      });
    }

    return res.status(200).json({
      eventId,
      ticketsCount: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error("Error en getTicketsBookByEventId:", error);
    return res.status(500).json({
      message: "Error al consultar los tickets por evento",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const payRemainingTicket = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { folio } = req.params;

    const {
      buyerEmail,
      buyerName,
      buyerPhone,
      metodoPago, // "STRIPE_CARD", "STRIPE_OXXO", "BANK_TRANSFER"
    } = req.body;

    // 1. Validaciones Iniciales
    if (!folio || !metodoPago) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "Folio y método de pago son requeridos." });
    }

    const validMethods = ["STRIPE_CARD", "STRIPE_OXXO", "BANK_TRANSFER"];
    if (!validMethods.includes(metodoPago)) {
      await t.rollback();
      return res.status(400).json({ message: "Método de pago no válido." });
    }

    const now = new Date();

    // 2. Buscar la Reserva Existente con Bloqueo Pessimistic
    const booking = await Booking.findOne({
      where: { folio },
      include: [
        {
          model: Ticket,
          as: "tickets",
          attributes: ["id", "code"],
          include: [
            {
              model: Event,
              attributes: ["id", "title"],
            },
          ],
        },
      ],
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!booking) {
      await t.rollback();
      return res.status(404).json({ message: "Reserva no encontrada." });
    }

    // 3. Validar Estado Financiero de la Reserva
    if (booking.pendingAmount <= 0 || booking.status === "PAID") {
      await t.rollback();
      return res.status(400).json({
        message: "Esta reserva ya no cuenta con saldo pendiente a liquidar.",
      });
    }

    // 4. Determinar Monto de Liquidación (40% Restante)
    const pendingAmountCentavos = Math.round(booking.pendingAmount * 100);

    // 5. Tiempos de Expiración para completar esta Liquidación (24 Horas)
    const reservationHours = 24;
    const expiresAt = new Date(
      now.getTime() + reservationHours * 60 * 60 * 1000,
    );

    // Actualizar datos del titular si los modificó/proporcionó en el modal
    if (buyerName) booking.buyerName = buyerName;
    if (buyerEmail) booking.buyerEmail = buyerEmail;
    if (buyerPhone) booking.buyerPhone = buyerPhone;

    // Si la liquidación se hace dentro de ventana válida, extendemos la fecha límite
    booking.dueDate = expiresAt;
    booking.paymentMethod = metodoPago;
    await booking.save({ transaction: t });

    // 6. Crear Registro en PaymentTicket para el Pago Restante
    const pagoTicket = await PaymentTicket.create(
      {
        bookingId: booking.id,
        amount: booking.pendingAmount,
        paymentMethod: metodoPago,
        transactionRef: null,
        status: "PENDING",
        notes: "Cobro Restante de Liquidación (40%)",
      },
      { transaction: t },
    );

    // Confirmar cambios iniciales de BD
    await t.commit();

    // ------------------------------------------------------------------
    // 8. Integración con Stripe Checkout para la Liquidación
    // ------------------------------------------------------------------
    let checkoutUrl = null;
    let stripeSessionId = null;
    const stripeExpiresAt = Math.floor(expiresAt.getTime() / 1000);
    if (["STRIPE_CARD", "STRIPE_OXXO"].includes(metodoPago)) {
      const stripeMethod = metodoPago === "STRIPE_CARD" ? ["card"] : ["oxxo"];

      const session = await stripe.checkout.sessions.create({
        payment_method_types: stripeMethod,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "mxn",
              product_data: {
                name: `Liquidación Final (40%) — Folio: ${folio}`,
                description: `Sueldo final para liberar boletos digitales del evento`,
              },
              unit_amount: pendingAmountCentavos,
            },
            quantity: 1,
          },
        ],
        expires_at: stripeExpiresAt,
        payment_method_options: {
          oxxo: {
            expires_after_days: 1,
          },
        },
        metadata: {
          bookingId: booking.id.toString(),
          folio: booking.folio,
          paymentType: "LIQUIDATION",
          metodoPago,
          flow: "LIQUIDACION_RESERVA", // 👈 Banderola clave para el Webhook de Stripe
          paymentTicketId: pagoTicket.id,
        },
        payment_intent_data: {
          metadata: {
            bookingId: booking.id.toString(),
            folio: booking.folio,
            paymentType: "LIQUIDATION",
            metodoPago,
            flow: "LIQUIDACION_RESERVA",
            paymentTicketId: pagoTicket.id,
          },
        },
        customer_email: buyerEmail || booking.buyerEmail,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/payment-success?session_id={CHECKOUT_SESSION_ID}&folio=${folio}&isLiquidation=true`,
        cancel_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/payment-error`,
      });

      checkoutUrl = session.url;
      stripeSessionId = session.id;

      // Actualizar la reserva con la nueva URL de checkout de liquidación
      await booking.update({ checkoutUrl });
    }

    // 9. Respuesta Final
    return res.status(200).json({
      success: true,
      message: "Proceso de liquidación iniciado exitosamente.",
      bookingId: booking.id,
      folio: booking.folio,
      paymentMethod: metodoPago,
      amountPaidToDate: booking.paidAmount,
      amountToPay: booking.pendingAmount,
      expiresAt: booking.dueDate,
      checkoutUrl,
      stripeSessionId,
    });
  } catch (error) {
    if (!t.finished) {
      await t.rollback();
    }
    console.error("💥 Error en payRemainingTicket:", error);
    return res
      .status(500)
      .json({ message: "Error procesando la solicitud de liquidación." });
  }
};

module.exports = {
  buyTicket,
  buyTicketOpen,
  getEventById,
  getEvents,
  createEvent,
  getLatestEvents,
  getSimilarEvents,
  updateEvent,
  downloadIcsFile,
  topEventsSales,
  deleteEvent,
  uploadTransferProof,
  getBookingByFolio,
  getTicketsBookByEventId,
  payRemainingTicket,
};
