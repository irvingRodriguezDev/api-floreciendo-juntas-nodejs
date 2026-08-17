const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, Subscription, NotificationToken } = require("../models");
const { addToBlacklist } = require("../utils/tokenBlacklist");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const { validationResult } = require("express-validator");
const socketModule = require("../socket");
const sequelize = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const convertImageIfNeeded = require("../helpers/convertImages");
const deleteFromS3 = require("../helpers/deleteFromS3");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const { Op } = require("sequelize");
dayjs.extend(customParseFormat);
// 1️⃣ LOGIN OPTIMIZADO (Donde fallaba la conexión)
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || typeof email !== "string" || !password) {
      return res.status(400).json({
        error: "Se requieren un email y contraseña válidos.",
      });
    }
    const user = await User.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ msg: "Credenciales inválidas" });
    }

    let sessionId = null;

    // 🔑 El punto crítico: El update del sessionId ahora se beneficia del 'retry' global
    if (user.roleId === 4) {
      sessionId = uuidv4();
      await user.update({ session_id: sessionId });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      profileImage: user.profileImage,
      ...(sessionId && { sessionId }),
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    const { password: _, ...safeUser } = user.toJSON();
    // Normalizamos la imagen de perfil en la respuesta del login
    safeUser.profileImage = getS3Url(safeUser.profileImage);

    res.json({ msg: "Login exitoso", token, user: safeUser });
  } catch (error) {
    console.error("Login error fatal:", error);
    res.status(500).json({ message: "Error en login", error: error.message });
  }
};

// 2️⃣ REGISTRO LIMPIO
const register = async (req, res) => {
  try {
    const { password, email, name, phone, username, tiktokUsername } = req.body;

    const exists = await User.findOne({ where: { email }, attributes: ["id"] });

    if (exists)
      return res
        .status(400)
        .json({ msg: "El correo ingresado ya esta registrado" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const sessionId = uuidv4();

    const newUser = await User.create({
      email,
      name,
      phone,
      username,
      password: hashedPassword,
      roleId: 4,
      session_id: sessionId,
      tiktokUsername: tiktokUsername || null, // Guardamos el tiktokUsername si viene
    });

    const token = jwt.sign(
      {
        id: newUser.id,
        email: newUser.email,
        roleId: newUser.roleId,
        name: newUser.name,
        profileImage: null,
        sessionId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" },
    );

    res.status(200).json({
      msg: "Usuario registrado",
      token,
      user: { id: newUser.id, email, name, username, roleId: 4 },
    });
  } catch (error) {
    res.status(500).json({ msg: "Error en registro", error: error.message });
  }
};

// 3️⃣ ME (Optimizado para no traer datos basura)
const me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "email",
        "name",
        "username",
        "stripe_id",
        "profileImage",
        "phone",
        "roleId",
        "createdAt",
        "tiktokUsername",
        "birthDate",
        "isVerified",
      ],
      include: [
        {
          model: Subscription,
          as: "Subscriptions",
          required: false,
          // Ordenamos para que las más recientes y activas tengan prioridad
        },
      ],
      // Ordenamos las suscripciones asociadas por fecha de creación (de la más nueva a la más vieja)
      order: [
        [{ model: Subscription, as: "Subscriptions" }, "createdAt", "DESC"],
      ],
    });

    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });
    const formattedDate = dayjs().format("MM-DD");
    const dayBirth = dayjs(user.birthDate).format("MM-DD");

    const todayIsBirthDay = dayBirth === formattedDate;
    const subscriptions = user.Subscriptions || [];

    // 1. Buscamos primero si tiene alguna suscripción VÁLIDA (active o past_due)
    let activeSub = subscriptions.find((sub) =>
      ["active", "past_due"].includes(sub.status),
    );

    // 2. Si no tiene activa/past_due, buscamos si tiene una 'canceled' que aún no vence (periodo pagado)
    if (!activeSub) {
      activeSub = subscriptions.find((sub) => {
        if (sub.status === "canceled" && sub.end_date) {
          const endDate = new Date(sub.end_date);
          return endDate > new Date(); // Todavía le quedan días pagados
        }
        return false;
      });
    }

    // 3. Si sigue sin encontrar, tomamos simplemente el registro más reciente (el primero del array ordenado)
    const currentSub = activeSub || subscriptions[0] || null;

    // Evaluamos si tiene acceso
    let isSubscribed = false;

    if (currentSub) {
      if (["active", "past_due"].includes(currentSub.status)) {
        isSubscribed = true;
      } else if (currentSub.status === "canceled" && currentSub.end_date) {
        // Acceso permitido si canceló pero su periodo sigue vigente
        isSubscribed = new Date(currentSub.end_date) > new Date();
      }
    }

    res.status(200).json({
      user: {
        ...user.get({ plain: true }),
        isSubscribed,
        profileImage: getS3Url(user.profileImage),
        todayIsBirthDay,
        subscriptionDetails: currentSub
          ? {
              id: currentSub.id,
              type: currentSub.subscription_type,
              status: currentSub.status,
              endDate: currentSub.end_date,
              next_renewal: currentSub.next_renewal,
              last_payment_at: currentSub.last_payment_at,
              will_cancel_at: currentSub.will_cancel_at,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error en /me:", error);
    res.status(500).json({ msg: "Error en /me", error: error.message });
  }
};

// 4️⃣ CREAR USUARIO (Admin) - CORREGIDO: S3 fuera de la transacción
const createUserWithRole = async (req, res) => {
  const { name, password, roleId, email, phone, username } = req.body;

  if (roleId < 2 || roleId > 5)
    return res.status(400).json({ msg: "Rol inválido" });

  const exists = await User.findOne({ where: { email }, attributes: ["id"] });
  if (exists) return res.status(400).json({ msg: "El usuario ya existe" });

  const hashedPassword = await bcrypt.hash(password, 10);
  let newUser;

  // Transacción corta solo para crear el registro
  const t = await sequelize.transaction();
  try {
    newUser = await User.create(
      { name, username, email, password: hashedPassword, roleId, phone },
      { transaction: t },
    );
    await t.commit();
  } catch (error) {
    if (t) await t.rollback();
    return res.status(500).json({ msg: "Error DB", error: error.message });
  }

  // S3 Fuera de la transacción para evitar bloqueos por lentitud de red
  if (req.file) {
    try {
      const s3Path = await uploadToS3("profileImages", req.file, newUser.id);
      await newUser.update({ profileImage: s3Path });
    } catch (err) {
      console.error("S3 Error (non-fatal for user creation):", err);
    }
  }

  res.status(201).json({
    message: "Usuario creado",
    user: { ...newUser.toJSON(), profileImage: getS3Url(newUser.profileImage) },
  });
};

// 5️⃣ SUBIR IMAGEN (Optimizado)
const uploadProfileImage = async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ ok: false, msg: "Debe seleccionar una imagen" });

  try {
    const user = await User.findByPk(req.user.id);
    if (!user)
      return res.status(404).json({ ok: false, msg: "Usuario no encontrado" });

    // Procesar y subir (Fuera de transacciones de DB)
    const processedFile = await convertImageIfNeeded(req.file);
    const uploadedKey = await uploadToS3(
      "profileImages",
      processedFile,
      `${user.id}-${Date.now()}`,
    );

    const oldImageKey = user.profileImage;
    await user.update({ profileImage: uploadedKey });

    // Limpieza asíncrona
    if (oldImageKey)
      deleteFromS3(oldImageKey).catch((e) =>
        console.error("Error delete S3:", e),
      );

    const publicUrl = getS3Url(uploadedKey);
    socketModule.getIO().to(`user_${user.id}`).emit("profileImageUpdated", {
      userId: user.id,
      profileImage: publicUrl,
    });

    return res.status(200).json({ ok: true, profileImage: publicUrl });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: error.message });
  }
};
const logout = async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    const { browserId } = req.body;

    if (!token) {
      return res.status(400).json({ msg: "Token no proporcionado" });
    }

    // 1️⃣ Operaciones de DB (Notificaciones y Sesión)
    // Usamos Promise.allSettled para que si falla una (ej. notificaciones),
    // igual intente cerrar la sesión del usuario.
    await Promise.allSettled([
      // Desactivar token de push si existe browserId
      browserId
        ? NotificationToken.update(
            { isActive: false },
            { where: { userId: req.user.id, browserId } },
          )
        : Promise.resolve(),

      // Invalidar sesión en tabla Users (Solo para rol 4)
      req.user.roleId === 4
        ? User.update({ session_id: null }, { where: { id: req.user.id } })
        : Promise.resolve(),
    ]);

    // 2️⃣ Blacklist (Operación en memoria/Redis usualmente, muy rápida)
    addToBlacklist(token);

    return res.status(200).json({ msg: "Logout exitoso" });
  } catch (error) {
    console.error("Logout error fatal:", error);
    // IMPORTANTE: Incluso si la DB falla, el cliente debe limpiar su token local
    return res.status(500).json({
      msg: "Error en servidor al cerrar sesión",
      error: error.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, password, passwordConfirmation } = req.body;

    if (!email || !password || !passwordConfirmation) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos." });
    }

    if (password !== passwordConfirmation) {
      return res.status(400).json({ message: "Las contraseñas no coinciden." });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res
        .status(400)
        .json({ message: "No existe una cuenta con ese correo." });
    }

    // Hasheo (Operación de CPU, no de DB, segura fuera de transacciones)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Actualización directa
    await user.update({
      password: hashedPassword,
      session_id: null, // ✨ Tip Pro: Al cambiar pass, cerramos todas las sesiones activas
    });

    res.status(200).json({ message: "Contraseña restablecida correctamente." });
  } catch (error) {
    console.error("Error al restablecer contraseña:", error);
    res.status(500).json({ message: "Error interno del servidor." });
  }
};
const updateInfoUser = async (req, res) => {
  try {
    const { name, phone, email, tiktokUsername } = req.body;

    // 1️⃣ Validar que al menos un campo venga
    if (!name && !phone && !email && !tiktokUsername) {
      return res.status(400).json({
        message: "Debes enviar al menos un campo para actualizar",
      });
    }

    // 2️⃣ Buscar usuario
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "email",
        "name",
        "username",
        "stripe_id",
        "profileImage",
        "phone",
        "roleId",
        "createdAt",
        "tiktokUsername",
      ], // Mantenemos stripe_id por si acaso
      // 2. Incluimos el modelo Subscription
      include: [
        {
          model: Subscription,
          as: "Subscriptions", // Si tienes un alias, úsalo aquí. Por defecto, puede ser 'Subscriptions'.
          // Buscamos solo la suscripción activa
          where: {
            status: "active",
          },
          required: false, // Usamos LEFT JOIN (el usuario se trae aunque no tenga suscripción)
          limit: 1, // Solo necesitamos el registro activo más reciente
          order: [["end_date", "DESC"]], // Ordenar para obtener el más reciente/relevante
        },
      ],
    });
    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    // 3️⃣ Actualizar solo lo que venga
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (email) user.email = email;
    if (tiktokUsername) user.tiktokUsername = tiktokUsername;

    await user.save();
    const activeSubscription =
      user.Subscriptions && user.Subscriptions.length > 0
        ? user.Subscriptions[0]
        : null;

    const isSubscribed = activeSubscription !== null;
    // 4️⃣ Respuesta
    return res.json({
      message: "Información actualizada correctamente",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        phone: user.phone,
        roleId: user.roleId,
        isSubscribed: isSubscribed, // Boolean: true/false
        profileImage: getS3Url(user.profileImage),
        member_since: user.createdAt,
        stripe_id: user.stripe_id,
        tiktokUsername: user.tiktokUsername,
        // Puedes enviar los detalles de la suscripción activa si los necesitas en el front
        subscriptionDetails: isSubscribed
          ? {
              type: activeSubscription.subscription_type,
              status: activeSubscription.status,
              startDate: activeSubscription.start_date,
              endDate: activeSubscription.end_date,
              nextRenewal: activeSubscription.next_renewal,
              will_cancel_at: activeSubscription.will_cancel_at,
            }
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Error al actualizar usuario",
    });
  }
};
const saveBirthDate = async (req, res) => {
  try {
    const userId = req.user.id;
    const { birthDate } = req.body;

    if (!birthDate) {
      return res.status(400).json({
        message: "La fecha de cumpleaños es obligatoria.",
      });
    }

    // 🔑 Usamos Day.js para formatear la fecha a YYYY-MM-DD
    let formattedBirthDate;

    if (typeof birthDate === "string" && birthDate.length === 5) {
      // Si viene como "MM-DD", le pasamos el formato explícito a Day.js
      formattedBirthDate = dayjs(birthDate, "MM-DD").format("2000-MM-DD");
    } else {
      // Si viene como ISO / YYYY-MM-DD
      formattedBirthDate = dayjs(birthDate).format("YYYY-MM-DD");
    }

    // Validamos que sea una fecha válida en Day.js
    if (!dayjs(formattedBirthDate, "YYYY-MM-DD", true).isValid()) {
      return res.status(400).json({
        message: "El formato de la fecha de cumpleaños no es válido.",
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado.",
      });
    }

    if (user.birthDate) {
      return res.status(400).json({
        message:
          "La fecha de cumpleaños ya ha sido registrada previamente y no se puede cambiar.",
      });
    }

    // Al asignarle a Sequelize la cadena limpia "2000-MM-DD",
    // Sequelize la sanitiza sin lanzar ningún warning.
    user.birthDate = formattedBirthDate;
    await user.save();

    return res.status(200).json({
      message: "Tu fecha de cumpleaños se ha registrado exitosamente.",
      birthDate: user.birthDate,
    });
  } catch (error) {
    console.error("Ocurrió un error al guardar la fecha de cumpleaños:", error);
    return res.status(500).json({
      message: "Ocurrió un problema al guardar la información.",
      error: error.message,
    });
  }
};

const getTodayBirthdays = async (req, res) => {
  try {
    const currentUserId = req.user?.id; // ID de la usuaria autenticada

    // 🔑 1. Obtenemos Mes (MM) y Día (DD) actuales
    const currentMonth = dayjs().format("MM");
    const currentDay = dayjs().format("DD");

    // 🔑 2. Consulta con Sequelize extrayendo Mes y Día independientemente del año guardado
    const usersList = await User.findAll({
      where: {
        isSubscribed: true,
        // Excluimos a la usuaria actual de la lista
        ...(currentUserId && { id: { [Op.ne]: currentUserId } }),

        // Comparamos el mes y día directamente sobre la columna birthDate de la BD
        [Op.and]: [
          sequelize.where(
            sequelize.fn("MONTH", sequelize.col("birthDate")),
            currentMonth,
          ),
          sequelize.where(
            sequelize.fn("DAY", sequelize.col("birthDate")),
            currentDay,
          ),
        ],
      },
      // Seleccionamos solo los campos públicos necesarios por privacidad/desempeño
      attributes: ["id", "name", "profileImage"],
      order: [["id", "DESC"]],
    });
    const users = usersList.map((c) => ({
      ...c.toJSON(),
      profileImage: c.profileImage ? getS3Url(c.profileImage) : null,
    }));
    return res.status(200).json({ users });
  } catch (error) {
    console.error("Error al obtener cumpleañeras:", error);
    return res.status(500).json({
      message: "Ocurrió un error al obtener la lista de cumpleañeras.",
      error: error.message,
    });
  }
};
module.exports = {
  register,
  login,
  profile: me, // profile ahora usa la lógica de me
  createUserWithRole,
  me,
  logout,
  resetPassword,
  uploadProfileImage,
  updateInfoUser,
  saveBirthDate,
  getTodayBirthdays,
};
