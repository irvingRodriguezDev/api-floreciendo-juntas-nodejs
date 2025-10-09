const { System } = require("../models");

// Obtener todos los sistemas
const getSystems = async (req, res) => {
  try {
    const systems = await System.findAll();
    res.json(systems);
  } catch (error) {
    console.error("Error al obtener los sistemas:", error);
    res.status(500).json({ message: "Error al obtener los sistemas" });
  }
};

// Crear un nuevo sistema
const createSystem = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "El nombre es obligatorio" });
    }

    // Verificar si ya existe
    const existingSystem = await System.findOne({ where: { name } });
    if (existingSystem) {
      return res
        .status(400)
        .json({ message: "Ya existe un sistema con ese nombre" });
    }

    const newSystem = await System.create({ name });
    res.status(201).json(newSystem);
  } catch (error) {
    console.error("Error al crear el sistema:", error);
    res.status(500).json({ message: "Error al crear el sistema" });
  }
};

// Actualizar un sistema
const updateSystem = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const system = await System.findByPk(id);
    if (!system) {
      return res.status(404).json({ message: "Sistema no encontrado" });
    }

    if (name) system.name = name;
    await system.save();

    res.json(system);
  } catch (error) {
    console.error("Error al actualizar el sistema:", error);
    res.status(500).json({ message: "Error al actualizar el sistema" });
  }
};

// Eliminar un sistema
const deleteSystem = async (req, res) => {
  try {
    const { id } = req.params;
    const system = await System.findByPk(id);

    if (!system) {
      return res.status(404).json({ message: "Sistema no encontrado" });
    }

    await system.destroy();
    res.json({ message: "Sistema eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar el sistema:", error);
    res.status(500).json({ message: "Error al eliminar el sistema" });
  }
};

module.exports = { getSystems, createSystem, updateSystem, deleteSystem };
