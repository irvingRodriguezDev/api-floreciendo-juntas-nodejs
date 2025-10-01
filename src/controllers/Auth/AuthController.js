const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User } = require("../../models");
const stripe = require("../../config/stripe");
// Registro
// Registro normal (usuario final)
const register = async (req, res) => {
  try {
    const { password, email, name, direction } = req.body;

    // Verificar si el usuario ya existe
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ msg: "Usuario ya existe" });

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear cliente en Stripe
    const stripeCustomer = await stripe.customers.create({
      email,
      name,
    });

    // Crear usuario en la base de datos
    const newUser = await User.create({
      email,
      name,
      direction,
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
        direction: newUser.direction,
        email: newUser.email,
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
      expiresIn: "1h",
    });

    res.json({ msg: "Login exitoso", token });
  } catch (error) {
    res.status(500).json({ msg: "Error en login", error: error.message });
  }
};

// Perfil
const profile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "direction", "email", "name", "createdAt"],
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
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "direction", "email", "name"],
    });
    res.status(200).json({ user });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al obtener la informacion", error: error.message });
  }
};

//crear rol del admin
const createUserWithRole = async (req, res) => {
  try {
    const { name, password, roleId, email } = req.body;

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
    });

    res.json({
      msg: "Usuario creado por admin",
      user: {
        id: newUser.id,
        name: newUser.name,
        roleId: newUser.roleId,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al crear usuario", error: error.message });
  }
};

module.exports = { register, login, profile, createUserWithRole, me };
