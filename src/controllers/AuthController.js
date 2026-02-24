const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, Subscription, NotificationToken } = require("../models");
const stripe = require("../config/stripe");
const { addToBlacklist } = require("../utils/tokenBlacklist");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const { validationResult } = require("express-validator");
const socketModule = require("../socket");
const sequelize = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const convertImageIfNeeded = require("../helpers/convertImages");
const deleteFromS3 = require("../helpers/deleteFromS3");

// Registro
// Registro normal (usuario final)
const register = async (req, res) => {
  try {
    const { password, email, name, phone, username } = req.body;
    // Verificar si el usuario ya existe
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ msg: "Usuario ya existe" });

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear cliente en Stripe
    const stripeCustomer = await stripe.customers.create({
      email,
      name,
      phone,
    });
    const sessionId = uuidv4();
    // Crear usuario en la base de datos
    const newUser = await User.create({
      email,
      name,
      phone,
      username,
      password: hashedPassword,
      roleId: 4,
      stripe_id: stripeCustomer.id,
      session_id: sessionId,
    });

    // Generar JWT
    const payload = {
      id: newUser.id,
      email: newUser.email,
      roleId: newUser.roleId,
      sessionId,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    // Responder con token
    res.status(200).json({
      msg: "Usuario registrado",
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        phone: newUser.phone,
        name: newUser.name,
        username: newUser.username,
        roleId: newUser.roleId,
        stripe_id: newUser.stripe_id,
      },
    });
  } catch (error) {
    res.status(500).json({ msg: "Error en registro", error: error.message });
  }
};

// Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ msg: "Credenciales inválidas" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Credenciales inválidas" });
    }

    let sessionId = null;

    // 🔑 SOLO usuarios normales (roleId === 4)
    if (user.roleId === 4) {
      sessionId = uuidv4();
      await user.update({ session_id: sessionId });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
    };

    // 👉 solo agregar sessionId si aplica
    if (sessionId) {
      tokenPayload.sessionId = sessionId;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    res.json({
      msg: "Login exitoso",
      token,
      user,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Error en login",
      error: error.message,
    });
  }
};

// Perfil
const profile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "email", "name", "createdAt"],
    });
    res.json({ msg: "Perfil de usuario", user });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al obtener perfil", error: error.message });
  }
};

const me = async (req, res) => {
  try {
    // 1. Encontramos el usuario, seleccionando sus atributos básicos
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
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }

    // 3. Determinar el estado de la suscripción para el frontend
    // Si la propiedad 'Subscriptions' (o el alias que uses) existe y tiene al menos 1 elemento
    const activeSubscription =
      user.Subscriptions && user.Subscriptions.length > 0
        ? user.Subscriptions[0]
        : null;

    const isSubscribed = activeSubscription !== null;

    // 4. Formatear y enviar la respuesta
    res.status(200).json({
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
  } catch (error) {
    console.error("Error en /auth/me:", error);
    res
      .status(500)
      .json({ msg: "Error al obtener la información", error: error.message });
  }
};
//crear rol del admin
const createUserWithRole = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { name, password, roleId, email, phone, username } = req.body;

    // Validar rol
    if (roleId < 2 || roleId > 5) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ msg: "Solo puedes asignar roles del 2 al 5" });
    }

    // Verificar si el usuario ya existe
    const exists = await User.findOne({ where: { email } });
    if (exists) {
      await transaction.rollback();
      return res.status(400).json({ msg: "El usuario ya existe" });
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 1️⃣ Crear usuario sin imagen
    const newUser = await User.create(
      {
        name,
        username,
        email,
        password: hashedPassword,
        roleId,
        phone,
        profileImage: null,
      },
      { transaction },
    );

    // 2️⃣ Subir imagen si se envía
    if (req.file) {
      try {
        const file = req.file;
        const s3Path = await uploadToS3("profileImages", file, newUser.id);
        await newUser.update({ profileImage: s3Path }, { transaction });
      } catch (err) {
        console.error("Error al subir imagen a S3:", err);
        await transaction.rollback();
        return res
          .status(500)
          .json({ message: "Error al subir la imagen de perfil" });
      }
    }

    // 3️⃣ Confirmar la transacción
    await transaction.commit();

    // 4️⃣ Responder al cliente
    res.status(201).json({
      message: "Usuario creado correctamente por el administrador",
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        username: newUser.username,
        roleId: newUser.roleId,
        profileImage: newUser.profileImage
          ? getS3Url(newUser.profileImage)
          : null,
        phone: newUser.phone,
      },
    });
  } catch (error) {
    console.error("❌ Error al crear usuario:", error);
    await transaction.rollback();
    res
      .status(500)
      .json({ msg: "Error al crear usuario", error: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    const { browserId } = req.body;

    if (!token) {
      return res.status(400).json({ msg: "Token no proporcionado" });
    }

    // 🔕 Desactivar notificaciones SOLO de este navegador
    if (browserId) {
      await NotificationToken.update(
        { isActive: false },
        {
          where: {
            userId: req.user.id,
            browserId,
          },
        },
      );
    }

    // 🔥 Invalidar sesión única SOLO para usuarios finales
    if (req.user.roleId === 4) {
      await req.user.update({ session_id: null });
    }

    // 🔒 Invalidar token actual
    addToBlacklist(token);

    return res.status(200).json({ msg: "Logout exitoso" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      msg: "Error en logout",
      error: error.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, password, passwordConfirmation } = req.body;

    // Validar campos
    if (!email || !password || !passwordConfirmation) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos." });
    }

    // Confirmar contraseñas
    if (password !== passwordConfirmation) {
      return res.status(400).json({ message: "Las contraseñas no coinciden." });
    }

    // Buscar usuario
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res
        .status(400)
        .json({ message: "No existe una cuenta con ese correo." });
    }

    // Encriptar nueva contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Actualizar contraseña
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({
      message: "Contraseña restablecida correctamente.",
    });
  } catch (error) {
    console.error("Error al restablecer contraseña:", error);
    res.status(500).json({ message: "Error interno del servidor." });
  }
};
//funcion para cargar la imagen de perfil
const uploadProfileImage = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      msg: "Errores de validación.",
      errors: errors.array(),
    });
  }

  if (!req.file) {
    return res.status(400).json({
      ok: false,
      msg: "Debe seleccionar una imagen.",
    });
  }

  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        msg: "Usuario no encontrado.",
      });
    }

    // 🔒 Validar que sea imagen
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({
        ok: false,
        msg: "El archivo debe ser una imagen válida (JPG, PNG, WEBP, HEIC).",
      });
    }

    // 🔥 Convertir si es necesario usando TU helper
    const processedFile = await convertImageIfNeeded(req.file);

    // 🔥 Generar key versionado (evita cache CDN)
    const newKey = `${userId}-${Date.now()}`;

    // Subir a S3
    const uploadedKey = await uploadToS3(
      "/profileImages",
      processedFile,
      newKey,
    );

    if (!uploadedKey) {
      return res.status(500).json({
        ok: false,
        msg: "No se pudo subir la imagen. Intente nuevamente.",
      });
    }

    const oldImageKey = user.profileImage;

    // Actualizar BD
    user.profileImage = uploadedKey;
    await user.save();

    // Intentar eliminar anterior (sin romper flujo)
    if (oldImageKey) {
      try {
        await deleteFromS3(oldImageKey);
      } catch (err) {
        console.error("Error eliminando imagen anterior:", err);
      }
    }

    const publicUrl = getS3Url(uploadedKey);

    const io = socketModule.getIO();
    io.to(`user_${userId}`).emit("profileImageUpdated", {
      userId,
      profileImage: publicUrl,
    });

    return res.status(200).json({
      ok: true,
      msg: "Imagen de perfil actualizada correctamente.",
      profileImage: publicUrl,
    });
  } catch (error) {
    console.error("Error al subir imagen:", error);

    return res.status(500).json({
      ok: false,
      msg: error.message || "Error inesperado al subir la imagen.",
    });
  }
};

const updateInfoUser = async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    // 1️⃣ Validar que al menos un campo venga
    if (!name && !phone && !email) {
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

module.exports = {
  register,
  login,
  profile,
  createUserWithRole,
  me,
  logout,
  resetPassword,
  uploadProfileImage,
  updateInfoUser,
};
