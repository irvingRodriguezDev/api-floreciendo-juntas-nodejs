const { CertificationModule, ModuleCriterion } = require("../models");

const CreateCriterion = async (req, res) => {
  try {
    const { moduleId, title, maxScore } = req.body;

    if (!moduleId || !title || !maxScore) {
      return res.status(400).json({
        message: "moduleId, title y maxScore son requeridos",
      });
    }

    if (maxScore <= 0) {
      return res.status(400).json({
        message: "maxScore debe ser mayor a 0",
      });
    }

    const module = await CertificationModule.findByPk(moduleId);

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

    const criterion = await ModuleCriterion.create({
      moduleId,
      title,
      maxScore,
    });

    return res.status(201).json(criterion);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const GetCriteriaByModule = async (req, res) => {
  try {
    const { moduleId } = req.params;

    const criteria = await ModuleCriterion.findAll({
      where: { moduleId },
      order: [["id", "ASC"]],
    });

    return res.json(criteria);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const UpdateCriterion = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, maxScore } = req.body;

    const criterion = await ModuleCriterion.findByPk(id);

    if (!criterion) {
      return res.status(404).json({
        message: "Criterio no encontrado",
      });
    }

    if (maxScore !== undefined && maxScore <= 0) {
      return res.status(400).json({
        message: "maxScore debe ser mayor a 0",
      });
    }

    criterion.title = title ?? criterion.title;
    criterion.maxScore = maxScore ?? criterion.maxScore;

    await criterion.save();

    return res.json(criterion);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const DeleteCriterion = async (req, res) => {
  try {
    const { id } = req.params;

    const criterion = await ModuleCriterion.findByPk(id);

    if (!criterion) {
      return res.status(404).json({
        message: "Criterio no encontrado",
      });
    }

    await criterion.destroy();

    return res.json({
      message: "Criterio eliminado correctamente",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  CreateCriterion,
  GetCriteriaByModule,
  UpdateCriterion,
  DeleteCriterion,
};
