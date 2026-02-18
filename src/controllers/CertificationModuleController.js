const { Certification, CertificationModule } = require("../models");

const CreateModule = async (req, res) => {
  try {
    const { certificationId, title } = req.body;

    if (!certificationId || !title) {
      return res.status(400).json({
        message: "certificationId y title son requeridos",
      });
    }

    // Verificar que la certificación exista
    const certification = await Certification.findByPk(certificationId);

    if (!certification) {
      return res.status(404).json({
        message: "Certificación no encontrada",
      });
    }

    const module = await CertificationModule.create({
      certificationId,
      title,
    });

    return res.status(201).json(module);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
const GetModulesByCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;

    const modules = await CertificationModule.findAll({
      where: { certificationId },
      order: [["id", "ASC"]],
    });

    return res.json(modules);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
const UpdateModule = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const module = await CertificationModule.findByPk(id);

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

    module.title = title ?? module.title;

    await module.save();

    return res.json(module);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
const DeleteModule = async (req, res) => {
  try {
    const { id } = req.params;

    const module = await CertificationModule.findByPk(id);

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

    await module.destroy();

    return res.json({
      message: "Módulo eliminado correctamente",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  DeleteModule,
  CreateModule,
  UpdateModule,
  GetModulesByCertification,
};
