const { FormationsModules } = require("../models"); // Ajusta la ruta al modelo según tu proyecto

// Crear un módulo (espera { name, formationId } en el body)
async function createModule(req, res) {
  try {
    const { name, formationId } = req.body;

    if (!name || !formationId) {
      return res
        .status(400)
        .json({ message: "name and formationId are required" });
    }

    const module = await FormationsModules.create({ name, formationId });
    return res.status(201).json(module);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}

// Editar un módulo (params: id) espera { name, formationId } en el body
async function updateModule(req, res) {
  try {
    const { id } = req.params;
    const { name, formationId } = req.body;
    if (!name || !formationId) {
      return res
        .status(400)
        .json({ message: "name and formationId are required" });
    }

    const module = await FormationsModules.findByPk(id);
    if (!module) {
      return res.status(404).json({ message: "Module not found" });
    }

    module.name = name;
    module.formationId = formationId;
    await module.save();

    return res.status(200).json(module);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}

// Listar módulos por formationId (params: formationId)
async function listModulesByFormation(req, res) {
  try {
    const { formationId } = req.params;
    if (!formationId) {
      return res.status(400).json({ message: "formationId is required" });
    }

    const modules = await FormationsModules.findAll({ where: { formationId } });
    return res.status(200).json(modules);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}

// Eliminar módulo por id (params: id)
async function deleteModule(req, res) {
  try {
    const { id } = req.params;
    const deletedCount = await FormationsModules.destroy({ where: { id } });

    if (!deletedCount) {
      return res.status(404).json({ message: "Module not found" });
    }

    return res.status(200).json({ message: "Module deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}

module.exports = {
  createModule,
  updateModule,
  listModulesByFormation,
  deleteModule,
};
