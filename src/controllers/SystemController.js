const getS3Url = require("../helpers/getS3Url");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const { System } = require("../models");
const deleteFromS3 = require("../helpers/deleteFromS3");
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

const showSystem = async (req, res) => {
  try {
    const { id } = req.params;
    const system = await System.findByPk(id);
    if (!system) {
      return res.status(400).json({ message: "Sistema no encontrado" });
    }
    return res.status(200).json(system);
  } catch (error) {
    return res.status(500).json({
      message: "Error al obtener el sistema",
      error: error.message,
    });
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

    let coverIcon = system.icon; // mantenemos el icono actual
    const path = "systems";

    // Si llega un nuevo archivo, eliminamos primero el anterior (si existe)
    if (req.file) {
      if (system.icon) {
        try {
          await deleteFromS3(system.icon);
        } catch (err) {
          console.error("Error al eliminar el icono anterior:", err);
          // Opcional: puedes decidir si quieres abortar la actualización o continuar
        }
      }

      // Subimos la nueva imagen
      const newIconKey = await uploadToS3(path, req.file, id);
      coverIcon = newIconKey;
    }

    // Actualizamos los datos del sistema
    await system.update({
      name,
      description,
      icon: coverIcon,
    });

    // Obtenemos la URL pública del icono actual
    const icon = coverIcon ? await getS3Url(coverIcon) : null;

    res.json({
      message: "El sistema se ha actualizado correctamente!",
      system: {
        ...system.toJSON(),
        icon,
      },
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

module.exports = {
  getSystems,
  createSystem,
  updateSystem,
  deleteSystem,
  showSystem,
};
