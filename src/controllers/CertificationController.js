const { Op } = require("sequelize");
const {
  Certification,
  CertificationModule,
  ModuleCriterion,
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
} = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const CreateCertification = async (req, res) => {
  try {
    const {
      name,
      start_date,
      end_date,
      min_passing_score,
      max_passing_score,
      is_active,
    } = req.body;

    const file = req.file;

    // 🔎 Validar archivo
    if (!file) {
      return res.status(400).json({
        message: "La imagen es requerida",
      });
    }

    // 🔎 Validar fechas
    if (new Date(start_date) >= new Date(end_date)) {
      return res.status(400).json({
        message: "La fecha de inicio debe ser menor a la fecha de fin",
      });
    }

    // 1️⃣ Crear certificación SIN imagen primero
    const certification = await Certification.create({
      name,
      start_date,
      end_date,
      min_passing_score,
      max_passing_score,
      is_active,
      image: null,
    });

    // 2️⃣ Subir imagen a S3 usando el ID recién creado
    const imagePath = await uploadToS3(
      "certifications",
      file,
      certification.id,
    );

    // 3️⃣ Guardar solo el path en DB
    certification.image = imagePath;
    await certification.save();

    // 4️⃣ Preparar respuesta con URL pública
    const certificationResponse = {
      ...certification.toJSON(),
      image: getS3Url(imagePath),
    };

    return res.status(201).json(certificationResponse);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
const GetActiveCertifications = async (req, res) => {
  try {
    const certifications = await Certification.findAll({
      where: {
        is_active: true,
      },
    });
    const wihtUrls = certifications.map((c) => ({
      ...c.toJSON(),
      image: c.image ? getS3Url(c.image) : null,
    }));
    return res.json(wihtUrls);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const GetCertificationById = async (req, res) => {
  try {
    const { id } = req.params;

    const certification = await Certification.findByPk(id, {
      include: [
        {
          model: CertificationModule,
          as: "modules",
        },
      ],
    });

    if (!certification) {
      return res.status(404).json({ message: "No encontrada" });
    }

    return res.json({ certification, image: getS3Url(certification.image) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const GetModuleCertificationById = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const userId = req.user.id;

    // 🔒 Validar suscripción
    if (!req.user.isSubscribed) {
      return res.status(403).json({
        message: "Necesitas una suscripción activa",
      });
    }

    // 🔎 Buscar módulo con todo incluido
    const module = await CertificationModule.findByPk(moduleId, {
      include: [
        {
          model: ModuleCriterion,
          as: "criteria",
        },
        {
          model: ModuleSubmission,
          as: "submissions",
          where: { userId },
          required: false,
          include: [
            {
              model: ModuleEvaluation,
              as: "evaluation",
              include: [
                {
                  model: EvaluationScore,
                  as: "scores",
                  include: [
                    {
                      model: ModuleCriterion,
                      as: "criterion",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

    const submission = module.submissions[0] || null;

    let status = "not_started";
    let formattedSubmission = null;
    let formattedEvaluation = null;

    if (submission) {
      formattedSubmission = {
        id: submission.id,
        submittedAt: submission.createdAt,
        photo_1: getS3Url(submission.photo_1),
        photo_2: getS3Url(submission.photo_2),
        photo_3: getS3Url(submission.photo_3),
      };

      status = "submitted";

      if (submission.evaluation) {
        status = "reviewed";

        const evaluation = submission.evaluation;

        const scoresFormatted = evaluation.scores.map((s) => ({
          id: s.id,
          criterionId: s.criterionId,
          criterionTitle: s.criterion?.title || null,
          score: s.score,
          max_score: s.criterion?.max_score || 5,
        }));

        const totalScore = scoresFormatted.reduce((sum, s) => sum + s.score, 0);

        formattedEvaluation = {
          id: evaluation.id,
          submissionId: evaluation.submissionId,
          teacherId: evaluation.teacherId,
          total_score: totalScore,
          general_feedback: evaluation.general_feedback,
          evaluated_at: evaluation.createdAt,
          scores: scoresFormatted,
        };
      }
    }

    return res.json({
      id: module.id,
      title: module.title,
      description: module.description,
      status,
      criteria: module.criteria,
      submission: formattedSubmission,
      evaluation: formattedEvaluation,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const GetMyCertificationDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.user.isSubscribed) {
      return res.status(403).json({
        message: "Necesitas una suscripción activa",
      });
    }

    const certification = await Certification.findByPk(id, {
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
              include: [
                {
                  model: ModuleEvaluation,
                  as: "evaluation",
                  include: [
                    {
                      model: EvaluationScore,
                      as: "scores",
                      attributes: ["score"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!certification) {
      return res.status(404).json({
        message: "Certificación no encontrada",
      });
    }

    let totalPoints = 0;
    let evaluatedModules = 0;

    const modulesFormatted = certification.modules.map((module) => {
      const submission = module.submissions[0] || null;

      let moduleScore = 0;

      if (submission?.evaluation) {
        evaluatedModules++;

        moduleScore = submission.evaluation.scores.reduce(
          (sum, s) => sum + s.score,
          0,
        );

        totalPoints += moduleScore;
      }

      return {
        id: module.id,
        title: module.title,
        delivered: !!submission,
        module_score: moduleScore,
      };
    });

    return res.json({
      id: certification.id,
      name: certification.name,
      start_date: certification.start_date,
      end_date: certification.end_date,
      min_passing_score: certification.min_passing_score,
      total_points: totalPoints,
      evaluated_modules: evaluatedModules,
      modules: modulesFormatted,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  GetActiveCertifications,
  GetCertificationById,
  CreateCertification,
  GetMyCertificationDetail,
  GetModuleCertificationById,
};
