const { Op } = require("sequelize");
const {
  Certification,
  CertificationModule,
  ModuleCriterion,
  ModuleSubmission,
  ModuleEvaluation,
  EvaluationScore,
  User,
  DownloadedCertificate,
} = require("../models");
const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const path = require("path");
const sharp = require("sharp");
const { generateFolio } = require("../helpers/FolioGenerator");

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
    const diplomaFile = req.files?.diploma?.[0];

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
    if (!diplomaFile) {
      return res.status(400).json({
        message: "El Diploma es requerido",
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
    const diplomaPath = await uploadToS3(
      "certifications/diploma",
      diplomaFile,
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
      diploma: getS3Url(diplomaPath),
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
      diploma: c.diploma ? getS3Url(c.diploma) : null,
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
      diploma: certification.diploma ? getS3Url(certification.diploma) : null,
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
      image: certification.image ? getS3Url(certification.image) : null,
      certificate: certification.certificate
        ? getS3Url(certification.certificate)
        : null,
      diploma: certification.diploma ? getS3Url(certification.diploma) : null,
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
    const { certificationId, nameCertification } = req.query;
    const userId = req.user.id;

    // ================================
    // 🔎 Buscar datos en BD en paralelo
    // ================================
    const [user, certificado, userCertification] = await Promise.all([
      User.findByPk(userId),
      Certification.findOne({ where: { id: certificationId } }),
      DownloadedCertificate.findOne({
        where: {
          user_id: userId,
          certification_id: certificationId,
        },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (!certificado) {
      return res.status(404).json({ message: "Certificado no encontrado" });
    }

    // ================================
    // 📋 Obtener o crear certificado con folio
    // ================================
    let downloadedCert;

    if (userCertification) {
      downloadedCert = userCertification;
      await downloadedCert.update({
        download_count: downloadedCert.download_count + 1,
        last_download_at: new Date(),
      });
    } else {
      const folio = await generateFolio();

      downloadedCert = await DownloadedCertificate.create({
        folio,
        score: 148,
        certification_id: certificationId,
        user_id: userId,
        issued_at: new Date(),
        download_count: 1,
        last_download_at: new Date(),
      });
    }

    const userName = nameCertification;
    const folio = downloadedCert.folio;
    const issuedDate = downloadedCert.issued_at;
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
    // 🎨 Fuente cursiva para nombre CON CENTRADO DINÁMICO
    // ================================
    const fontPath = path.join(__dirname, "../fonts/Ephesis-Regular.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const customFont = await pdfDoc.embedFont(fontBytes);

    // 🔧 ÁREA DISPONIBLE PARA EL NOMBRE (ajusta estos valores según tu diseño)
    const nameAreaLeft = 75; // Margen izquierdo del área del nombre
    const nameAreaRight = width - 75; // Margen derecho del área del nombre
    const availableWidth = nameAreaRight - nameAreaLeft;

    const yPosition = 475;

    // 🔧 CALCULAR TAMAÑO DE FUENTE DINÁMICO
    let textSize = 55; // Tamaño máximo deseado
    const minTextSize = 35; // Tamaño mínimo para nombres muy largos
    let textWidth = customFont.widthOfTextAtSize(userName, textSize);

    // Si el texto es muy ancho, reducir el tamaño proporcionalmente
    while (textWidth > availableWidth && textSize > minTextSize) {
      textSize -= 1;
      textWidth = customFont.widthOfTextAtSize(userName, textSize);
    }

    // Si aún es muy largo con el tamaño mínimo, forzar que quepa
    if (textWidth > availableWidth) {
      textSize = (availableWidth / textWidth) * textSize;
      textWidth = customFont.widthOfTextAtSize(userName, textSize);
    }

    // ✅ CENTRADO REAL basado en el ancho del texto
    const xCentered = nameAreaLeft + (availableWidth - textWidth) / 2;

    page.drawText(userName, {
      x: xCentered,
      y: yPosition,
      size: textSize,
      font: customFont,
      color: rgb(0.0, 0.0, 0.0),
    });

    // ================================
    // 📝 Agregar FOLIO al PDF
    // ================================
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const folioText = `Folio: ${folio}`;
    const folioSize = 12;
    const folioWidth = helveticaFont.widthOfTextAtSize(folioText, folioSize);

    page.drawText(folioText, {
      x: width - folioWidth - 50,
      y: 40,
      size: folioSize,
      font: helveticaFont,
      color: rgb(0.0, 0.0, 0.0),
    });

    // ================================
    // 📅 Agregar FECHA DE EMISIÓN
    // ================================
    const dateText = `Fecha de emisión: ${issuedDate.toLocaleDateString("es-MX")}`;
    const dateSize = 12;

    page.drawText(dateText, {
      x: 50,
      y: 40,
      size: dateSize,
      font: helveticaFont,
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
        x: width - 580,
        y: 560,
        width: 140,
        height: 190,
      });
    }

    // ================================
    // 💾 Enviar PDF
    // ================================
    const pdfBytes = await pdfDoc.save();
    const fileName = `certificado_${userName.replace(/ /g, "_")}_${folio}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("Error generando certificado:", error);
    res.status(500).json({ message: "Error generando certificado" });
  }
};
const UpdateCertification = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      start_date,
      end_date,
      min_passing_score,
      max_passing_score,
      is_active,
    } = req.body;

    // 🔎 Buscar la certificación primero
    const certification = await Certification.findByPk(id);
    if (!certification) {
      return res.status(404).json({
        message: "Certificación no encontrada",
      });
    }

    // 🔎 Validar fechas (solo si ambas están presentes en el body)
    const startDate = start_date
      ? new Date(start_date)
      : new Date(certification.start_date);
    const endDate = end_date
      ? new Date(end_date)
      : new Date(certification.end_date);

    if (startDate >= endDate) {
      return res.status(400).json({
        message: "La fecha de inicio debe ser menor a la fecha de fin",
      });
    }

    // 📂 Procesar archivos (Solo si vienen en el request)
    const imageFile = req.files?.image?.[0];
    const certificateFile = req.files?.certificate?.[0];
    const diplomaFile = req.files?.diploma?.[0];

    let imagePath = certification.image;
    let certificatePath = certification.certificate;
    let diplomaPath = certification.diploma;

    if (imageFile) {
      imagePath = await uploadToS3("certifications", imageFile, id);
    }
    if (certificateFile) {
      certificatePath = await uploadToS3(
        "certifications/certificate",
        certificateFile,
        id,
      );
    }
    if (diplomaFile) {
      diplomaPath = await uploadToS3("certifications/diploma", diplomaFile, id);
    }

    // 📝 Actualizar campos en la DB
    await certification.update({
      name: name ?? certification.name,
      start_date: start_date ?? certification.start_date,
      end_date: end_date ?? certification.end_date,
      min_passing_score: min_passing_score ?? certification.min_passing_score,
      max_passing_score: max_passing_score ?? certification.max_passing_score,
      is_active: is_active !== undefined ? is_active : certification.is_active,
      image: imagePath,
      certificate: certificatePath,
      diploma: diplomaPath,
    });

    // 4️⃣ Preparar respuesta con URL pública
    const certificationResponse = {
      ...certification.toJSON(),
      image: getS3Url(imagePath),
      certificate: getS3Url(certificatePath),
      diploma: getS3Url(diplomaPath),
    };

    return res.status(200).json(certificationResponse);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

const downloadDiploma = async (req, res) => {
  try {
    const { certificationId, nombreDiploma } = req.query;
    const userId = req.user.id;

    // ================================
    // 🔎 Obtener datos del usuario y la certificación
    // ================================
    const [user, certification] = await Promise.all([
      User.findByPk(userId),
      Certification.findByPk(certificationId),
    ]);

    if (!user || !certification) {
      return res.status(404).json({ message: "Información no encontrada" });
    }

    // ================================
    // 📥 Descarga de recursos en paralelo
    // ================================
    const s3Path = certification.diploma;
    const pdfUrl = getS3Url(s3Path);

    const [existingPdfBytes, fontBytes] = await Promise.all([
      fetch(pdfUrl).then((r) => r.arrayBuffer()),
      fs.promises.readFile(
        path.join(__dirname, "../fonts/Ephesis-Regular.ttf"),
      ),
    ]);

    // ================================
    // 📄 Configuración del documento PDF
    // ================================
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    pdfDoc.registerFontkit(fontkit);

    const customFont = await pdfDoc.embedFont(fontBytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // ================================
    // 🎨 Nombre del Alumno con CENTRADO DINÁMICO REAL
    // ================================
    const studentName = nombreDiploma;

    // 🔧 ÁREA DISPONIBLE PARA EL NOMBRE
    const nameAreaLeft = 75; // Margen izquierdo
    const nameAreaRight = width - 75; // Margen derecho
    const availableWidth = nameAreaRight - nameAreaLeft;

    const yPosition = 470;

    // 🔧 CALCULAR TAMAÑO DE FUENTE DINÁMICO
    let fontSize = 65; // Tamaño máximo deseado
    const minFontSize = 40; // Tamaño mínimo para nombres muy largos
    let textWidth = customFont.widthOfTextAtSize(studentName, fontSize);

    // Si el texto es muy ancho, reducir el tamaño proporcionalmente
    while (textWidth > availableWidth && fontSize > minFontSize) {
      fontSize -= 1;
      textWidth = customFont.widthOfTextAtSize(studentName, fontSize);
    }

    // Si aún es muy largo con el tamaño mínimo, forzar que quepa
    if (textWidth > availableWidth) {
      fontSize = (availableWidth / textWidth) * fontSize;
      textWidth = customFont.widthOfTextAtSize(studentName, fontSize);
    }

    // ✅ CENTRADO REAL basado en el ancho exacto del texto
    const xCentered = nameAreaLeft + (availableWidth - textWidth) / 2;

    page.drawText(studentName, {
      x: xCentered,
      y: yPosition,
      size: fontSize,
      font: customFont,
      color: rgb(0, 0, 0),
    });

    // ================================
    // 💾 Generar y enviar el archivo
    // ================================
    const pdfBytes = await pdfDoc.save();
    const fileName = `Diploma_${studentName.replace(/\s+/g, "_")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("Error al procesar el diplomado:", error);
    return res.status(500).json({
      message: "No pudimos generar tu diploma en este momento.",
      error: error.message,
    });
  }
};

module.exports = {
  GetActiveCertifications,
  GetCertificationById,
  CreateCertification,
  GetMyCertificationDetail,
  GetModuleCertificationById,
  downloadCertificate,
  UpdateCertification,
  downloadDiploma,
};
