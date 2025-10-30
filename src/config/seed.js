const bcrypt = require("bcryptjs");
const { Role, User } = require("../models");

async function seedData() {
  // Crear roles por defecto
  const roles = [
    { id: 1, name: "Administrador" },
    { id: 2, name: "Multimedia" },
    { id: 3, name: "Evaluador" },
    { id: 4, name: "Usuario" },
    { id: 5, name: "Scanner" },
  ];

  for (const role of roles) {
    await Role.findOrCreate({ where: { id: role.id }, defaults: role });
  }

  // Crear usuario admin por defecto
  const adminExists = await User.findOne({ where: { name: "admin" } });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await User.create({
      name: "admin",
      email: "admin@g.com",
      password: hashedPassword,
      phone: "7223224244",
      roleId: 1,
    });
    console.log("Usuario admin creado: admin / admin123");
  }
}

module.exports = seedData;
