const {
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
  ModuleCriterion,
  CertificationModule,
} = require("../models");
const sequelize = require("../config/db");
const CreateEvaluation = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { submissionId, feedback, scores } = req.body;

    if (!submissionId || !scores || !Array.isArray(scores)) {
      return res.status(400).json({
        message: "submissionId y scores son requeridos",
      });
    }

    // ✅ Buscar submission con criteria en una sola query
    const submission = await ModuleSubmission.findByPk(submissionId, {
      attributes: ["id", "status", "moduleId"],
      include: {
        model: CertificationModule,
        as: "module",
        attributes: ["id"],
        include: {
          model: ModuleCriterion,
          as: "criteria",
          attributes: ["id", "maxScore"],
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission no encontrada" });
    }

    if (submission.status === "evaluated") {
      return res.status(400).json({ message: "Esta entrega ya fue evaluada" });
    }

    const criteria = submission.module.criteria;

    if (scores.length !== criteria.length) {
      return res
        .status(400)
        .json({ message: "Debes evaluar todos los criterios" });
    }

    // ✅ Validar todos los scores ANTES de tocar la BD
    const criteriaById = {};
    for (const c of criteria) {
      criteriaById[c.id] = c;
    }

    for (const scoreItem of scores) {
      const criterion = criteriaById[scoreItem.criterionId];

      if (!criterion) {
        return res.status(400).json({
          message: `Criterio inválido: ${scoreItem.criterionId}`,
        });
      }

      if (scoreItem.score > criterion.maxScore) {
        return res.status(400).json({
          message: `El score no puede ser mayor a ${criterion.maxScore}`,
        });
      }
    }

    const total = scores.reduce((sum, s) => sum + s.score, 0);

    // ✅ Todo en una transacción — si algo falla, se revierte todo
    await sequelize.transaction(async (t) => {
      const evaluation = await ModuleEvaluation.create(
        {
          submissionId,
          teacherId,
          general_feedback: feedback,
          total_score: total,
        },
        { transaction: t },
      );

      // ✅ bulkCreate en vez de N creates secuenciales — 1 sola query
      await EvaluationScore.bulkCreate(
        scores.map((s) => ({
          evaluationId: evaluation.id,
          criterionId: s.criterionId,
          score: s.score,
        })),
        { transaction: t },
      );

      await ModuleSubmission.update(
        { status: "reviewed" },
        { where: { id: submissionId }, transaction: t },
      );
    });

    return res.status(201).json({
      message: "Evaluación realizada correctamente",
      total_score: total,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const GetEvaluationBySubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const evaluation = await ModuleEvaluation.findOne({
      where: { submissionId },
      attributes: [
        "id",
        "submissionId",
        "teacherId",
        "total_score",
        "general_feedback",
        "createdAt",
      ],
      include: [
        {
          model: EvaluationScore,
          as: "scores",
          attributes: ["id", "criterionId", "score"],
          include: {
            model: ModuleCriterion,
            as: "criterion",
            attributes: ["id", "title", "maxScore"],
          },
        },
      ],
    });

    if (!evaluation) {
      return res.status(404).json({ message: "Evaluación no encontrada" });
    }

    return res.json(evaluation);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
module.exports = {
  CreateEvaluation,
  GetEvaluationBySubmission,
};
