const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User } = require("../../models");

// Registro
// Registro normal (usuario final)
const register = async (req, res) => {
  try {
    const { username, password, email, name } = req.body;

    const exists = await User.findOne({ where: { username } });
    if (exists) return res.status(400).json({ msg: "Usuario ya existe" });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Usuario normal se registra con roleId = 4
    const newUser = await User.create({
      username,
      email,
      name,
      password: hashedPassword,
      roleId: 4,
    });

    res.json({
      msg: "Usuario registrado",
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        name: newUser.name,
        roleId: newUser.roleId,
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
      attributes: ["id", "username", "email", "name", "createdAt"],
    });
    res.json({ msg: "Perfil de usuario", user });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al obtener perfil", error: error.message });
  }
};

//crear rol del admin
const createUserWithRole = async (req, res) => {
  try {
    const { username, password, roleId } = req.body;

    if (roleId < 1 || roleId > 3) {
      return res
        .status(400)
        .json({ msg: "Solo puedes asignar roles 1, 2 o 3" });
    }

    const exists = await User.findOne({ where: { username } });
    if (exists) return res.status(400).json({ msg: "Usuario ya existe" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      username,
      password: hashedPassword,
      roleId,
    });

    res.json({
      msg: "Usuario creado por admin",
      user: {
        id: newUser.id,
        username: newUser.username,
        roleId: newUser.roleId,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Error al crear usuario", error: error.message });
  }
};

module.exports = { register, login, profile, createUserWithRole };
