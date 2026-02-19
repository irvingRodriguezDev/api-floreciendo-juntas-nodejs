const getS3Url = require("../helpers/getS3Url");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  ModuleSubmission,
  CertificationModule,
  Certification,
  User,
} = require("../models");

const CreateSubmission = async (req, res) => {
  try {
    const userId = req.user.id;
    const { moduleId } = req.body;

    if (!moduleId) {
      return res.status(400).json({
        message: "moduleId es requerido",
      });
    }

    if (!req.files || req.files.length !== 3) {
      return res.status(400).json({
        message: "Debes subir exactamente 3 imágenes",
      });
    }

    // 1️⃣ Buscar módulo con certificación
    const module = await CertificationModule.findByPk(moduleId, {
      include: {
        model: Certification,
        as: "certification",
      },
    });

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

    if (!module.certification.is_active) {
      return res.status(400).json({
        message: "La certificación no está activa",
      });
    }

    // 2️⃣ Validar entrega previa
    const existingSubmission = await ModuleSubmission.findOne({
      where: { userId, moduleId },
    });

    if (existingSubmission) {
      return res.status(400).json({
        message: "Ya entregaste este módulo",
      });
    }

    // 3️⃣ Crear submission base
    const submission = await ModuleSubmission.create({
      userId,
      moduleId,
      photo_1: "temporal_1",
      photo_2: "temporal_2",
      photo_3: "temporal_3",
      status: "submitted",
    });

    // 4️⃣ Subir imágenes a S3
    const photo1Path = await uploadToS3(
      "evaluations",
      req.files[0],
      `${submission.id}_1`,
    );

    const photo2Path = await uploadToS3(
      "evaluations",
      req.files[1],
      `${submission.id}_2`,
    );

    const photo3Path = await uploadToS3(
      "evaluations",
      req.files[2],
      `${submission.id}_3`,
    );

    submission.photo_1 = photo1Path;
    submission.photo_2 = photo2Path;
    submission.photo_3 = photo3Path;

    await submission.save();

    // 5️⃣ Traer certificación actualizada con módulos
    const updatedCertification = await Certification.findByPk(
      module.certification.id,
      {
        include: [
          {
            model: CertificationModule,
            as: "modules",
            include: [
              {
                model: ModuleSubmission,
                as: "submissions",
                where: { userId },
                required: false,
              },
            ],
          },
        ],
      },
    );

    return res.status(201).json({
      message: "Entregable enviado correctamente",
      moduleId: submission.moduleId,
      status: submission.status,
      submission: {
        ...submission.toJSON(),
        photo1: getS3Url(photo1Path),
        photo2: getS3Url(photo2Path),
        photo3: getS3Url(photo3Path),
      },
      certification: updatedCertification,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Error al enviar el entregable",
    });
  }
};

const GetMySubmissions = async (req, res) => {
  try {
    const userId = req.user.id;

    const submissions = await ModuleSubmission.findAll({
      where: { userId },
      include: {
        model: CertificationModule,
        as: "module",
      },
      order: [["createdAt", "DESC"]],
    });

    const formatted = submissions.map((s) => ({
      ...s.toJSON(),
      photo1: getS3Url(s.photo_1),
      photo2: getS3Url(s.photo_2),
      photo3: getS3Url(s.photo_3),
    }));

    return res.json(formatted);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const GetAllSubmissionSubmitted = async (req, res) => {
  try {
    const submissions = await ModuleSubmission.findAll({
      where: { status: "submitted" },
      include: [
        {
          model: CertificationModule,
          as: "module",
          attributes: ["id", "title", "certificationId"],
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "id", "phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(submissions);
  } catch (error) {
    return res.status(500).json({ error: error, message: "ocurrio un error" });
  }
};

const GetAllSubmissionReviewed = async (req, res) => {
  try {
    const submissions = await ModuleSubmission.findAll({
      where: { status: "reviewed" },
      include: [
        {
          model: CertificationModule,
          as: "module",
          attributes: ["id", "title"],
          include: {
            model: Certification,
            as: "certification",
            attributes: ["id", "name"],
          },
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "id", "phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
      order: [["createdAt", "DESC"]],
    });
    const formatted = submissions.map((s) => ({
      ...s.toJSON(),
      photo1: getS3Url(s.photo_1),
      photo2: getS3Url(s.photo_2),
      photo3: getS3Url(s.photo_3),
    }));

    return res.json(formatted);
  } catch (error) {
    return res.status(500).json({ error: error, message: "ocurrio un error" });
  }
};

module.exports = {
  CreateSubmission,
  GetMySubmissions,
  GetAllSubmissionSubmitted,
  GetAllSubmissionReviewed,
};
