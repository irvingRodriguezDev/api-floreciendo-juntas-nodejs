const {
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
  ModuleCriterion,
  CertificationModule,
} = require("../models");

const CreateEvaluation = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { submissionId, feedback, scores } = req.body;

    if (!submissionId || !scores || !Array.isArray(scores)) {
      return res.status(400).json({
        message: "submissionId y scores son requeridos",
      });
    }

    // 1️⃣ Validar submission
    const submission = await ModuleSubmission.findByPk(submissionId, {
      include: {
        model: CertificationModule,
        as: "module",
        include: {
          model: ModuleCriterion,
          as: "criteria",
        },
      },
    });
    if (!submission) {
      return res.status(404).json({
        message: "Submission no encontrada",
      });
    }

    if (submission.status === "evaluated") {
      return res.status(400).json({
        message: "Esta entrega ya fue evaluada",
      });
    }

    // 2️⃣ Validar que se estén evaluando todos los criterios
    const criteria = submission.module.criteria;

    if (scores.length !== criteria.length) {
      return res.status(400).json({
        message: "Debes evaluar todos los criterios",
      });
    }

    // 3️⃣ Crear evaluación
    const evaluation = await ModuleEvaluation.create({
      submissionId,
      teacherId,
      general_feedback: feedback,
      total_score: 0,
    });

    let total = 0;

    // 4️⃣ Validar y crear scores
    for (const scoreItem of scores) {
      const criterion = criteria.find((c) => c.id === scoreItem.criterionId);

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

      await EvaluationScore.create({
        evaluationId: evaluation.id,
        criterionId: criterion.id,
        score: scoreItem.score,
      });

      total += scoreItem.score;
    }

    // 5️⃣ Guardar total
    evaluation.total_score = total;
    await evaluation.save();

    // 6️⃣ Cambiar estado de submission
    submission.status = "reviewed";
    await submission.save();

    return res.status(201).json({
      message: "Evaluación realizada correctamente",
      total_score: total,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const GetEvaluationBySubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;

    const evaluation = await ModuleEvaluation.findOne({
      where: { submissionId },
      include: [
        {
          model: EvaluationScore,
          as: "scores",
          include: {
            model: ModuleCriterion,
            as: "criterion",
          },
        },
      ],
    });

    if (!evaluation) {
      return res.status(404).json({
        message: "Evaluación no encontrada",
      });
    }

    return res.json(evaluation);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  CreateEvaluation,
  GetEvaluationBySubmission,
};
