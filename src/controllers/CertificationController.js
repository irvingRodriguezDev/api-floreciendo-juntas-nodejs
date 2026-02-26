const { Op } = require("sequelize");
const {
  Certification,
  CertificationModule,
  ModuleCriterion,
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
  User,
} = require("../models");
const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const path = require("path");
const sharp = require("sharp");

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

    const imageFile = req.files?.image?.[0];
    const certificateFile = req.files?.certificate?.[0];

    // 🔎 Validar archivo
    if (!imageFile) {
      return res.status(400).json({
        message: "La imagen es requerida",
      });
    }
    if (!certificateFile) {
      return res.status(400).json({
        message: "El certificado es requerido",
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
      imageFile,
      certification.id,
    );
    const certificatePath = await uploadToS3(
      "certifications/certificate",
      certificateFile,
      certification.id,
    );

    // 3️⃣ Guardar solo el path en DB
    certification.image = imagePath;
    certification.certificate = certificatePath;
    await certification.save();

    // 4️⃣ Preparar respuesta con URL pública
    const certificationResponse = {
      ...certification.toJSON(),
      image: getS3Url(imagePath),
      certificate: getS3Url(certificatePath),
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

    return res.json({
      certification,
      image: getS3Url(certification.image),
      certificate: getS3Url(certification.certificate),
    });
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

    // ✅ 3 queries planas en paralelo en vez de 1 JOIN de 5 niveles
    const [module, criteria, submission] = await Promise.all([
      CertificationModule.findByPk(moduleId, {
        attributes: ["id", "title"],
      }),
      ModuleCriterion.findAll({
        where: { moduleId },
        attributes: ["id", "title", "max_score"],
      }),
      ModuleSubmission.findOne({
        where: { moduleId, userId },
        attributes: ["id", "createdAt", "photo_1", "photo_2", "photo_3"],
        include: [
          {
            model: ModuleEvaluation,
            as: "evaluation",
            attributes: [
              "id",
              "submissionId",
              "teacherId",
              "general_feedback",
              "createdAt",
            ],
            include: [
              {
                model: EvaluationScore,
                as: "scores",
                attributes: ["id", "criterionId", "score"],
              },
            ],
          },
        ],
      }),
    ]);

    if (!module) {
      return res.status(404).json({
        message: "Módulo no encontrado",
      });
    }

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

        // ✅ Index de criteria por id para O(1) en vez de buscar en cada score
        const criteriaById = {};
        for (const c of criteria) {
          criteriaById[c.id] = c;
        }

        const scoresFormatted = evaluation.scores.map((s) => {
          const criterion = criteriaById[s.criterionId] || null;
          return {
            id: s.id,
            criterionId: s.criterionId,
            criterionTitle: criterion?.title || null,
            score: s.score,
            max_score: criterion?.max_score || 5,
          };
        });

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
      criteria,
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

    // ✅ Separamos en 2 queries planas en paralelo
    // en vez de 1 query con 4 niveles de JOIN
    const [certification, submissions] = await Promise.all([
      Certification.findByPk(id, {
        include: [
          {
            model: CertificationModule,
            as: "modules",
            attributes: ["id", "title"],
          },
        ],
      }),
      ModuleSubmission.findAll({
        where: { userId },
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
      }),
    ]);

    if (!certification) {
      return res.status(404).json({
        message: "Certificación no encontrada",
      });
    }

    // ✅ Indexamos submissions por moduleId para O(1) en el map
    const submissionByModuleId = {};
    for (const sub of submissions) {
      submissionByModuleId[sub.moduleId] = sub;
    }

    let totalPoints = 0;
    let evaluatedModules = 0;

    const modulesFormatted = certification.modules.map((module) => {
      const submission = submissionByModuleId[module.id] || null;
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
      image: getS3Url(certification.image),
      certificate: getS3Url(certification.certificate),
      start_date: certification.start_date,
      end_date: certification.end_date,
      min_passing_score: certification.min_passing_score,
      total_points: totalPoints,
      total_modules: certification.modules.length,
      evaluated_modules: evaluatedModules,
      modules: modulesFormatted,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
const downloadCertificate = async (req, res) => {
  try {
    const { certificationId } = req.query;
    const userId = req.user.id;

    // ================================
    // 🔎 Buscar datos en BD en paralelo
    // ================================
    const [user, certificado] = await Promise.all([
      User.findByPk(userId),
      Certification.findOne({ where: { id: certificationId } }),
    ]);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (!certificado) {
      return res.status(404).json({ message: "Certificado no encontrado" });
    }

    // ✅ BD ya no se necesita a partir de aquí
    const userName = user.name;
    const pdfUrl = getS3Url(certificado.certificate);
    const imageUrl = user.profileImage ? getS3Url(user.profileImage) : null;

    // ================================
    // 📥 Descargar PDF e imagen en paralelo
    // ================================
    const [existingPdfBytes, originalBuffer] = await Promise.all([
      fetch(pdfUrl).then((r) => r.arrayBuffer()),
      imageUrl
        ? fetch(imageUrl).then((r) => r.arrayBuffer())
        : Promise.resolve(null),
    ]);

    // ================================
    // 📄 Cargar y editar PDF
    // ================================
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    pdfDoc.registerFontkit(fontkit);

    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // ================================
    // 🎨 Fuente cursiva
    // ================================
    const fontPath = path.join(__dirname, "../fonts/Ephesis-Regular.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const customFont = await pdfDoc.embedFont(fontBytes);

    const textSize = 150;
    const xCentered = (width - 1800) / 2;
    const yPosition = 1950;

    page.drawText(userName, {
      x: xCentered,
      y: yPosition,
      size: textSize,
      font: customFont,
      color: rgb(0.0, 0.0, 0.0),
    });

    // ================================
    // 🖼 Imagen oval (solo si existe)
    // ================================
    if (originalBuffer) {
      const makeOvalImage = async (imageBuffer, w, h) => {
        const svgMask = `
          <svg width="${w}" height="${h}">
            <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="white"/>
          </svg>
        `;

        return await sharp(imageBuffer)
          .resize(w, h)
          .composite([{ input: Buffer.from(svgMask), blend: "dest-in" }])
          .png()
          .toBuffer();
      };

      const ovalBuffer = await makeOvalImage(
        Buffer.from(originalBuffer),
        500,
        650,
      );
      const embeddedImage = await pdfDoc.embedPng(ovalBuffer);

      page.drawImage(embeddedImage, {
        x: width - 750,
        y: 2150,
        width: 500,
        height: 650,
      });
    }

    // ================================
    // 💾 Enviar PDF
    // ================================
    const pdfBytes = await pdfDoc.save();
    const fileName = `certificado_${userName.replace(/ /g, "_")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error generando certificado" });
  }
};

module.exports = {
  GetActiveCertifications,
  GetCertificationById,
  CreateCertification,
  GetMyCertificationDetail,
  GetModuleCertificationById,
  downloadCertificate,
};
