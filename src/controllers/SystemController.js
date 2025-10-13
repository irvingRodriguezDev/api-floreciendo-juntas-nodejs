const getS3Url = require("../helpers/getS3Url");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const { System } = require("../models");

// Obtener todos los sistemas
const getSystems = async (req, res) => {
  try {
    const systems = await System.findAll();

    const formatted = systems.map((s) => ({
      ...s.toJSON(),
      icon: getS3Url(s.icon),
    }));
    res.json(formatted);
  } catch (error) {
    console.error("Error al obtener los sistemas:", error);
    res.status(500).json({ message: "Error al obtener los sistemas" });
  }
};

// Crear un nuevo sistema
const createSystem = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !description) {
      return res
        .status(400)
        .json({ message: "El nombre y la descripción son obligatorios" });
    }

    // Verificar si ya existe
    const existingSystem = await System.findOne({ where: { name } });
    if (existingSystem) {
      return res
        .status(400)
        .json({ message: "Ya existe un sistema con ese nombre" });
    }

    const newSystem = await System.create({ name, description });

    if (req.file) {
      const coverPathIcon = await uploadToS3("systems", req.file, newSystem.id);
      newSystem.icon = coverPathIcon;
      await newSystem.save();
    }
    res.status(201).json(newSystem);
  } catch (error) {
    console.error("Error al crear el sistema:", error);
    res.status(500).json({ message: "Error al crear el sistema", error });
  }
};

// Actualizar un sistema
const updateSystem = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const system = await System.findByPk(id);
    if (!system) {
      return res.status(404).json({ message: "Sistema no encontrado" });
    }
    let coverIcon = system.icon;
    const path = "systems";
    if (req.file) {
      const newIcon = await uploadToS3(req.file, path);
      if (system.icon) {
        await deleteFromS3(system.icon);
      }
      icon = newIcon;
    }

    await system.update({
      ...req.body,
      coverIcon,
    });

    res.json({
      message: "El sistema se ha actualizado correctamente!",
      system,
    });
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
