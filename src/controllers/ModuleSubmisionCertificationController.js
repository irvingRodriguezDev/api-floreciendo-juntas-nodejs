const { Op } = require("sequelize");
const getS3Url = require("../helpers/getS3Url");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  ModuleSubmission,
  CertificationModule,
  Certification,
  User,
  ModuleEvaluation,
  ModuleCriterion,
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

    // ✅ Buscar módulo y validar entrega previa en paralelo
    const [module, existingSubmission] = await Promise.all([
      CertificationModule.findByPk(moduleId, {
        include: {
          model: Certification,
          as: "certification",
          attributes: ["id", "is_active"],
        },
      }),
      ModuleSubmission.findOne({
        where: { userId, moduleId },
        attributes: ["id"],
      }),
    ]);

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

    if (existingSubmission) {
      return res.status(400).json({
        message: "Ya entregaste este módulo",
      });
    }

    // ✅ Crear submission base
    const submission = await ModuleSubmission.create({
      userId,
      moduleId,
      photo_1: "temporal_1",
      photo_2: "temporal_2",
      photo_3: "temporal_3",
      status: "submitted",
    });

    // ✅ Subir las 3 imágenes a S3 en paralelo
    const [photo1Path, photo2Path, photo3Path] = await Promise.all([
      uploadToS3("evaluations", req.files[0], `${submission.id}_1`),
      uploadToS3("evaluations", req.files[1], `${submission.id}_2`),
      uploadToS3("evaluations", req.files[2], `${submission.id}_3`),
    ]);

    submission.photo_1 = photo1Path;
    submission.photo_2 = photo2Path;
    submission.photo_3 = photo3Path;
    await submission.save();

    // ✅ Respuesta limpia sin query extra innecesaria
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
    const {
      page = 1,
      limit = 10,
      search = "",
      certificationId,
      moduleId,
    } = req.query;

    const isSearchMode = search.trim() !== "";

    // Convertir a números seguros
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const offset = (pageNumber - 1) * limitNumber;

    // =============================
    // WHERE principal
    // =============================
    const whereCondition = {
      status: "submitted",
    };

    // =============================
    // WHERE para USER (search)
    // =============================
    const userWhere = {};

    if (isSearchMode) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
      ];
    }

    // =============================
    // WHERE para MODULE
    // =============================
    const moduleWhere = {};

    if (certificationId) {
      moduleWhere.certificationId = certificationId;
    }

    if (moduleId) {
      moduleWhere.id = moduleId;
    }

    // =============================
    // Query base
    // =============================
    const queryOptions = {
      where: whereCondition,
      include: [
        {
          model: CertificationModule,
          as: "module",
          attributes: ["id", "title", "certificationId"], // SIN imágenes
          where: Object.keys(moduleWhere).length ? moduleWhere : undefined,
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "email", "phone"], // SIN imágenes
          where: isSearchMode ? userWhere : undefined,
        },
      ],
      order: [["createdAt", "DESC"]],
    };

    // =============================
    // Si NO es búsqueda → paginar
    // =============================
    if (!isSearchMode) {
      queryOptions.limit = limitNumber;
      queryOptions.offset = offset;

      const { count, rows } =
        await ModuleSubmission.findAndCountAll(queryOptions);

      return res.json({
        total: count,
        page: pageNumber,
        totalPages: Math.ceil(count / limitNumber),
        data: rows,
      });
    }

    // =============================
    // Si es búsqueda → sin paginar
    // =============================
    const submissions = await ModuleSubmission.findAll({
      queryOptions,
      limit: 100,
    });

    return res.json({
      total: submissions.length,
      data: submissions,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Ocurrió un error",
      error: error.message,
    });
  }
};

const GetAllSubmissionReviewed = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      certificationId,
      moduleId,
    } = req.query;

    const isSearchMode = search.trim() !== "";
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const userWhere = isSearchMode
      ? {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } },
          ],
        }
      : undefined;

    const moduleWhere = {};
    if (certificationId) moduleWhere.certificationId = certificationId;
    if (moduleId) moduleWhere.id = moduleId;

    const options = {
      where: { status: "reviewed" },
      include: [
        {
          model: CertificationModule,
          as: "module",
          attributes: ["id", "title", "certificationId"],
          where: Object.keys(moduleWhere).length > 0 ? moduleWhere : undefined,
          include: [
            {
              model: Certification,
              as: "certification",
              attributes: ["id", "name"],
            },
            // IMPORTANTE: Traemos los criterios asociados a este módulo
            {
              model: ModuleCriterion,
              as: "criteria",
              attributes: ["max_score"],
            },
          ],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "email", "phone"],
          where: userWhere,
        },
        {
          model: ModuleEvaluation,
          as: "evaluation",
          attributes: ["id", "total_score"],
        },
      ],
      order: [["createdAt", "DESC"]],
      distinct: true,
    };

    // Función auxiliar para formatear y sumar
    const formatSubmissions = (rows) => {
      return rows.map((s) => {
        const json = s.get({ plain: true });

        // 1. Extraemos los criterios que trajo Sequelize para este módulo específico
        const criteriaList = json.module?.criteria || [];

        // 2. Sumamos cada valor 'maxScore' de los criterios correspondientes
        const totalPossible = criteriaList.reduce((sum, criterion) => {
          return sum + (Number(criterion.max_score) || 0);
        }, 0);

        // 3. Retornamos el objeto limpio
        return {
          id: json.id,
          createdAt: json.createdAt,
          status: json.status,
          user: {
            id: json.user?.id,
            name: json.user?.name,
            email: json.user?.email,
          },
          module: {
            id: json.module?.id,
            title: json.module?.title,
            certification_name: json.module?.certification?.name,
          },
          evaluation: {
            score_obtained: json.evaluation?.total_score || 0,
            max_score_module: totalPossible, // La suma de sus criterios
            percentage:
              totalPossible > 0
                ? (
                    ((json.evaluation?.total_score || 0) / totalPossible) *
                    100
                  ).toFixed(2) + "%"
                : "0%",
          },
        };
      });
    };

    if (!isSearchMode) {
      options.limit = limitNumber;
      options.offset = offset;

      const { count, rows } = await ModuleSubmission.findAndCountAll(options);

      return res.json({
        total: count,
        page: pageNumber,
        totalPages: Math.ceil(count / limitNumber),
        data: formatSubmissions(rows), // Aplicamos el formato aquí
      });
    }

    const submissions = await ModuleSubmission.findAll(options);
    return res.json({
      total: submissions.length,
      data: formatSubmissions(submissions), // Y aquí
    });
  } catch (error) {
    console.error("❌ Error en GetAllSubmissionReviewed:", error);
    return res.status(500).json({
      message: "Ocurrió un error",
      error: error.message,
    });
  }
};

module.exports = {
  CreateSubmission,
  GetMySubmissions,
  GetAllSubmissionSubmitted,
  GetAllSubmissionReviewed,
};
