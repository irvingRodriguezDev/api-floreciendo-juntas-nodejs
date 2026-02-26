const {
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
  ModuleCriterion,
  CertificationModule,
} = require("../models");
const sequelize = require("../config/db");
const getS3Url = require("../helpers/getS3Url");
const CreateEvaluation = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { submissionId, feedback, scores } = req.body;

    // 1. Validaciones básicas de entrada
    if (!submissionId || !scores || !Array.isArray(scores)) {
      return res.status(400).json({
        message: "submissionId y scores son requeridos",
      });
    }

    // 2. Consulta inicial de datos (Lectura rápida sin transacción para validar existencia)
    const submissionData = await ModuleSubmission.findByPk(submissionId, {
      attributes: ["id", "status", "moduleId"],
      include: {
        model: CertificationModule,
        as: "module",
        attributes: ["id"],
        include: {
          model: ModuleCriterion,
          as: "criteria",
          attributes: ["id", "max_score"],
        },
      },
    });

    if (!submissionData) {
      return res.status(404).json({ message: "Submission no encontrada" });
    }

    const criteria = submissionData.module.criteria;
    if (scores.length !== criteria.length) {
      return res
        .status(400)
        .json({ message: "Debes evaluar todos los criterios" });
    }

    // 3. Validar scores contra criterios
    const criteriaById = {};
    criteria.forEach((c) => (criteriaById[c.id] = c));

    for (const scoreItem of scores) {
      const criterion = criteriaById[scoreItem.criterionId];
      if (!criterion) {
        return res
          .status(400)
          .json({ message: `Criterio inválido: ${scoreItem.criterionId}` });
      }
      if (scoreItem.score > criterion.maxScore) {
        return res.status(400).json({
          message: `El score no puede ser mayor a ${criterion.maxScore}`,
        });
      }
    }

    const total = scores.reduce((sum, s) => sum + s.score, 0);

    // --- INICIO DE PROCESAMIENTO CRÍTICO ---
    let result;

    await sequelize.transaction(async (t) => {
      // 4. Bloqueo de fila (SELECT FOR UPDATE)
      // Evita que dos profes evalúen lo mismo al mismo tiempo
      const sub = await ModuleSubmission.findByPk(submissionId, {
        attributes: ["id", "status"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (sub.status === "reviewed" || sub.status === "evaluated") {
        const error = new Error("Esta entrega ya fue evaluada");
        error.name = "CustomBusinessError";
        throw error;
      }

      // 5. Crear la evaluación
      const evaluation = await ModuleEvaluation.create(
        {
          submissionId,
          teacherId,
          general_feedback: feedback,
          total_score: total,
        },
        { transaction: t },
      );

      // 6. BulkCreate (Una sola query de inserción múltiple)
      await EvaluationScore.bulkCreate(
        scores.map((s) => ({
          evaluationId: evaluation.id,
          criterionId: s.criterionId,
          score: s.score,
        })),
        { transaction: t },
      );

      // 7. Actualizar status
      await sub.update({ status: "reviewed" }, { transaction: t });

      result = {
        message: "Evaluación realizada correctamente",
        total_score: total,
      };
    });

    // 8. Respuesta fuera de la transacción (Conexión liberada)
    return res.status(201).json(result);
  } catch (error) {
    console.error("❌ Error en CreateEvaluation:", error);

    if (error.name === "CustomBusinessError") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({
      message: "Error interno del servidor",
      error: error.message,
    });
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
          // 1. Incluimos la Submission para traer las fotos
          model: ModuleSubmission,
          as: "submission",
          attributes: ["id", "photo_1", "photo_2", "photo_3", "status"],
        },
        {
          model: EvaluationScore,
          as: "scores",
          attributes: ["id", "criterionId", "score"],
          include: {
            model: ModuleCriterion,
            as: "criterion",
            attributes: ["id", "title", "max_score"],
          },
        },
      ],
    });

    if (!evaluation) {
      return res.status(404).json({ message: "Evaluación no encontrada" });
    }

    // 2. Convertimos a JSON plano para manipular las URLs
    const evaluationData = evaluation.get({ plain: true });

    // 3. Procesamos las imágenes de la submission con el helper
    if (evaluationData.submission) {
      evaluationData.submission.photo_1_url = evaluationData.submission.photo_1
        ? await getS3Url(evaluationData.submission.photo_1)
        : null;

      evaluationData.submission.photo_2_url = evaluationData.submission.photo_2
        ? await getS3Url(evaluationData.submission.photo_2)
        : null;

      evaluationData.submission.photo_3_url = evaluationData.submission.photo_3
        ? await getS3Url(evaluationData.submission.photo_3)
        : null;
    }

    return res.json(evaluationData);
  } catch (error) {
    console.error("❌ Error en GetEvaluationBySubmission:", error);
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  CreateEvaluation,
  GetEvaluationBySubmission,
};
