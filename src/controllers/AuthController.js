const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, Subscription } = require("../models");
const stripe = require("../config/stripe");
const { addToBlacklist } = require("../utils/tokenBlacklist");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const { validationResult } = require("express-validator");
const socketModule = require("../socket");
// Registro
// Registro normal (usuario final)
const register = async (req, res) => {
  try {
    const { password, email, name, phone } = req.body;
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

    // Crear usuario en la base de datos
    const newUser = await User.create({
      email,
      name,
      phone,
      password: hashedPassword,
      roleId: 4,
      stripe_id: stripeCustomer.id,
    });

    // Generar JWT
    const payload = {
      id: newUser.id,
      email: newUser.email,
      roleId: newUser.roleId,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
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
    if (!user) return res.status(400).json({ msg: "Credenciales inválidas" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ msg: "Credenciales inválidas" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    res.json({ msg: "Login exitoso", token, user });
  } catch (error) {
    res.status(500).json({ message: "Error en login", error: error.message });
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
        "stripe_id",
        "profileImage",
        "phone",
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
        phone: user.phone,
        isSubscribed: isSubscribed, // Boolean: true/false
        profileImage: getS3Url(user.profileImage),
        member_since: user.createdAt,
        // Puedes enviar los detalles de la suscripción activa si los necesitas en el front
        subscriptionDetails: isSubscribed
          ? {
              type: activeSubscription.subscription_type,
              status: activeSubscription.status,
              endDate: activeSubscription.end_date,
              nextRenewal: activeSubscription.next_renewal,
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
  try {
    const { name, password, roleId, email, direction } = req.body;

    if (roleId < 1 || roleId > 3) {
      return res
        .status(400)
        .json({ msg: "Solo puedes asignar roles 1, 2 o 3" });
    }

    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ msg: "Usuario ya existe" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      password: hashedPassword,
      roleId,
      direction,
      email,
    });

    res.json({
      msg: "Usuario creado por admin",
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        roleId: newUser.roleId,
        direction: newUser.direction,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al crear usuario", error: error.message });
  }
};

const logout = (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(400).json({ msg: "Token no proporcionado" });
  }

  addToBlacklist(token);

  res.status(200).json({ msg: "Logout exitoso. Token invalidado." });
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
        .status(404)
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
    return res.status(400).json({ errors: errors.array() });
  }

  if (!req.file) {
    return res
      .status(400)
      .json({ msg: "No se ha proporcionado ningún archivo." });
  }

  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ msg: "Usuario no encontrado." });
    }

    // Subir el archivo a S3
    const file = req.file;
    const s3Key = await uploadToS3("profileImages", file, userId);

    // Guardar la referencia en el modelo User
    user.profileImage = s3Key;
    await user.save();

    // Obtener la URL pública usando getS3Url
    const publicUrl = getS3Url(user.profileImage);

    const io = socketModule.getIO();
    io.to(`user_${userId}`).emit("profileImageUpdated", {
      userId,
      profileImage: publicUrl,
    });

    res.json({
      msg: "Imagen de perfil subida exitosamente",
      profileImage: publicUrl,
      user, // opcional: enviar datos del usuario actualizados
    });
  } catch (err) {
    console.error("Error al subir la imagen:", err.message);
    res.status(500).send("Error del servidor");
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
};
