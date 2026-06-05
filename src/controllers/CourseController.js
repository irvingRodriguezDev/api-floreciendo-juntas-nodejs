const {
  Course,
  System,
  ImageCourses,
  CourseVideo,
  CourseProgress,
  CertificateCourse,
} = require("../models");
const { Op, json } = require("sequelize");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const deleteFromS3 = require("../helpers/deleteFromS3");
const Sequelize = require("sequelize");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require('path');
const fontkit = require("@pdf-lib/fontkit");

//funcion para crear el curso
const createCourse = async (req, res) => {
  try {
    const { title, description, level, hasCertificate, system_id } = req.body;

    if (!title || !description || !system_id) {
      return res.status(400).json({
        message:
          "Los campos 'title', 'description' y 'system_id' son obligatorios",
      });
    }

    // ✅ Validar archivos ANTES de tocar la BD
    const imageFile = req.files?.coverImage?.[0];
    const certificateFile = req.files?.certificate?.[0];
    const workbookFile = req.files?.workbook?.[0];

    if (workbookFile && workbookFile.mimetype !== "application/pdf") {
      return res.status(400).json({
        message: "El workbook debe ser un archivo PDF",
      });
    }

    const system = await System.findByPk(system_id, { attributes: ["id"] });
    if (!system) {
      return res
        .status(404)
        .json({ message: "El sistema especificado no existe" });
    }

    const slug = slugify(title, { lower: true, strict: true });

    // ✅ Crear curso
    const course = await Course.create({
      title,
      slug,
      description,
      level,
      hasCertificate,
      system_id,
    });

    // ✅ Todos los uploads en paralelo — BD ya libre desde aquí
    const [workbookKey, imageKey, certificateKey] = await Promise.all([
      workbookFile
        ? uploadToS3("workbooks", workbookFile, course.id)
        : Promise.resolve(null),
      imageFile
        ? uploadToS3("courses", imageFile, `img_${course.id}`)
        : Promise.resolve(null),
      certificateFile
        ? uploadToS3("certificates", certificateFile, `cert_${course.id}`)
        : Promise.resolve(null),
    ]);

    // ✅ Todas las escrituras a BD en paralelo con los keys ya listos
    await Promise.all([
      workbookKey
        ? course.update({ workbookUrl: workbookKey })
        : Promise.resolve(),
      imageKey
        ? ImageCourses.create({
            courseId: course.id,
            s3_key: imageKey,
            is_active: true,
          })
        : Promise.resolve(),
      certificateKey
        ? CertificateCourse.create({
            courseId: course.id,
            s3_key_certificate: certificateKey,
            is_active: true,
          })
        : Promise.resolve(),
    ]);

    // ✅ Query final solo con lo necesario
    const createdCourse = await Course.findByPk(course.id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
          attributes: ["s3_key"],
        },
      ],
    });

    return res.status(201).json({
      message: "Curso creado correctamente",
      course: {
        ...createdCourse.toJSON(),
        cover_image_url: createdCourse.images?.[0]
          ? getS3Url(createdCourse.images[0].s3_key) + `?t=${Date.now()}`
          : null,
      },
    });
  } catch (error) {
    console.error("❌ Error al crear curso:", error);
    return res.status(500).json({
      message: "Error al crear curso",
      error: error.message,
    });
  }
};
const getCourses = async (req, res) => {
  try {
    const courses = await Course.findAll({
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false, // si no hay imagen activa, igualmente trae el curso
        },
        {
          model: CertificateCourse,
          as: "certificates",
          where: { is_active: true },
          required: false, // si no hay imagen activa, igualmente trae el curso
        },
      ],
    });

    // Si quieres ver las imágenes correctamente

    const formatted = courses.map((c) => ({
      ...c.toJSON(),
      cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
      certificate_url: c.certificates?.[0]
        ? getS3Url(c.certificates[0].s3_key_certificate)
        : null,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    res.status(500).json({ msg: "Error al obtener los cursos" });
  }
};
const getNewCourses = async (req, res) => {
  try {
    const { userId } = req.query;

    // 🔹 Inclusiones base: imágenes activas
    const includes = [
      {
        model: ImageCourses,
        as: "images",
        where: { is_active: true },
        required: false, // LEFT JOIN: incluso si no tiene imágenes
        attributes: ["id", "s3_key"],
      },
    ];

    // 🔹 Si hay usuario autenticado, incluir progreso del curso
    if (userId) {
      includes.push({
        model: CourseProgress,
        as: "progresses",
        where: { userId: Number(userId) },
        required: false, // LEFT JOIN para que salgan todos los cursos
        attributes: ["percent"], // solo necesitamos el porcentaje
      });
    }

    // 🔹 Obtener los cursos más recientes
    const courses = await Course.findAll({
      include: includes,
      order: [["createdAt", "DESC"]],
      limit: 10,
      attributes: ["id", "title", "description", "createdAt"],
    });

    // 🔹 Transformar resultados
    const formattedCourses = courses.map((course) => {
      const data = course.toJSON();

      // Imagen de portada (solo la primera activa)
      const coverImageUrl = data.images?.[0]
        ? getS3Url(data.images[0].s3_key)
        : null;

      // Progreso del usuario (si existe)
      const userProgress =
        userId && data.progresses?.length > 0
          ? Number(data.progresses[0].percent)
          : 0;

      return {
        id: data.id,
        title: data.title,
        description: data.description,
        createdAt: data.createdAt,
        cover_image_url: coverImageUrl,
        user_progress_percentage: userProgress,
      };
    });

    return res.status(200).json(formattedCourses);
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    return res
      .status(500)
      .json({ msg: "Error al obtener los cursos más recientes" });
  }
};
const getCoursesPaginate = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;

    const isSearchMode = search.trim() !== "";

    const queryOptions = {
      where: {},
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
        {
          model: CourseVideo,
          as: "video", // Asegúrate de usar el mismo alias definido en la asociación
          where: { is_active: true },
          required: true, // el curso puede no tener video aún
        },
      ],
      order: [["createdAt", "DESC"]],
    };

    // 🟢 MODO BÚSQUEDA
    if (isSearchMode) {
      queryOptions.where = {
        [Op.or]: [
          { title: { [Op.like]: `%${search.trim()}%` } },
          { description: { [Op.like]: `%${search.trim()}%` } },
        ],
      };

      const courses = await Course.findAll(queryOptions);

      const formatted = courses.map((c) => ({
        ...c.toJSON(),
        cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
        video_url: c.video?.cloudfrontUrl || null, // 👈 URL del video activo
      }));

      return res.json({
        totalItems: formatted.length,
        courses: formatted,
      });
    }

    // 🟡 PAGINACIÓN
    const parsedLimit = parseInt(limit, 10) || 10;
    const parsedPage = parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    queryOptions.limit = parsedLimit;
    queryOptions.offset = offset;

    const result = await Course.findAndCountAll(queryOptions);

    const formatted = result.rows.map((c) => ({
      ...c.toJSON(),
      cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
      video_url: c.video?.cloudfrontUrl || null, // 👈 Agregamos el video activo
    }));

    const totalPages = Math.ceil(result.count / parsedLimit);

    return res.json({
      totalItems: result.count,
      totalPages,
      currentPage: parsedPage,
      courses: formatted,
    });
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    res.status(500).json({ msg: "Error al obtener los cursos" });
  }
};
const getCoursesBySystem = async (req, res) => {
  try {
    const { system_id, page = 1, limit = 10, search = "" } = req.query;

    if (!system_id) {
      return res
        .status(400)
        .json({ msg: "El campo 'system_id' es obligatorio." });
    }

    const isSearchMode = search.trim() !== "";

    // ⚙️ Configuración base de consulta
    const queryOptions = {
      where: { system_id },
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
        {
          model: CourseVideo,
          as: "video",
          where: { is_active: true },
          required: false, // 👈 para que también se muestren los cursos sin video
        },
      ],
      order: [["createdAt", "DESC"]],
    };

    // 🟢 Si hay búsqueda, la agregamos sin perder el filtro por sistema
    if (isSearchMode) {
      queryOptions.where = {
        system_id,
        [Op.or]: [
          { title: { [Op.like]: `%${search.trim()}%` } },
          { description: { [Op.like]: `%${search.trim()}%` } },
        ],
      };

      const courses = await Course.findAll(queryOptions);

      const formatted = courses.map((c) => ({
        ...c.toJSON(),
        cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
        video_url: c.video?.cloudfrontUrl || null,
      }));

      return res.json({
        totalItems: formatted.length,
        totalPages: 1,
        currentPage: 1,
        courses: formatted,
      });
    }

    // 🟡 Modo paginación normal
    const parsedLimit = parseInt(limit, 10) || 10;
    const parsedPage = parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    queryOptions.limit = parsedLimit;
    queryOptions.offset = offset;

    const result = await Course.findAndCountAll(queryOptions);

    const formatted = result.rows.map((c) => ({
      ...c.toJSON(),
      cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
      video_url: c.video?.cloudfrontUrl || null,
    }));

    return res.json({
      totalItems: result.count,
      totalPages: Math.ceil(result.count / parsedLimit),
      currentPage: parsedPage,
      courses: formatted,
    });
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    res
      .status(500)
      .json({ msg: "Error al obtener los cursos", error: error.message });
  }
};
//topcursos
const getTopViewedCourses = async (req, res) => {
  try {
    // 1. Obtener top 10 courseIds con su conteo — query limpia sin includes
    const topRaw = await CourseProgress.findAll({
      attributes: [
        "courseId",
        [Sequelize.fn("COUNT", Sequelize.col("userId")), "viewsCount"],
      ],
      group: ["courseId"],
      order: [[Sequelize.literal("viewsCount"), "DESC"]],
      limit: 10,
      raw: true,
    });

    if (!topRaw.length) return res.json([]);

    const courseIds = topRaw.map((r) => r.courseId);

    // 2. Traer los datos completos de esos cursos
    const courses = await Course.findAll({
      where: { id: courseIds },
      attributes: ["id", "title", "description"],
      include: [
        {
          model: ImageCourses,
          as: "images",
          attributes: ["s3_key"],
          where: { is_active: true },
          required: false,
        },
      ],
    });

    // 3. Mapear respuesta respetando el orden original del ranking
    const courseMap = new Map(courses.map((c) => [c.id, c]));

    const formatted = topRaw.map((row) => {
      const course = courseMap.get(row.courseId);
      const firstImage = course?.images?.[0];

      return {
        courseId: row.courseId,
        viewsCount: Number(row.viewsCount),
        title: course?.title ?? null,
        description: course?.description ?? null,
        cover_image_url: firstImage ? getS3Url(firstImage.s3_key) : null,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener top cursos más vistos" });
  }
};

// Obtener un curso por ID
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Buscar curso con sus imágenes activas
    const course = await Course.findByPk(id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
        {
          model: CourseVideo,
          as: "video", // Asegúrate de usar el mismo alias definido en la asociación
          where: { is_active: true },
          required: false, // el curso puede no tener video aún
        },
        {
          model: CertificateCourse,
          as: "certificates",
          where: { is_active: true },
          required: false, // si no hay imagen activa, igualmente trae el curso
        },
      ],
    });

    // ⚠️ Validar si existe
    if (!course) {
      return res.status(404).json({ msg: "Curso no encontrado" });
    }

    // ✅ Generar URL completa para las imágenes desde S3
    const formattedCourse = {
      ...course.toJSON(),

      cover_image_url: course.images?.[0]
        ? getS3Url(course.images[0].s3_key)
        : null,

      video_url: course.video?.cloudfrontUrl || null,

      images: course.images?.map((img) => ({
        ...img.toJSON(),
        url: getS3Url(img.s3_key),
      })),

      certificate_url: course.certificates?.[0]
        ? getS3Url(course.certificates[0].s3_key_certificate)
        : null,

      // 🔥 AQUÍ agregamos el workbook
      workbookUrl: course.workbookUrl ? getS3Url(course.workbookUrl) : null,
    };

    return res.status(200).json(formattedCourse);
  } catch (error) {
    console.error("❌ Error al obtener el curso:", error);
    return res.status(500).json({
      msg: "Error interno al obtener el curso",
      error: error.message,
    });
  }
};
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Validar archivo antes de tocar la BD
    const imageFile = req.files?.coverImage?.[0];
    const certificateFile = req.files?.certificate?.[0];
    const workbookFile = req.files?.workbook?.[0];

    if (workbookFile && workbookFile.mimetype !== "application/pdf") {
      return res.status(400).json({
        message: "El workbook debe ser un archivo PDF",
      });
    }

    // ✅ Buscar curso con solo los campos necesarios
    const course = await Course.findByPk(id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          attributes: ["id", "s3_key", "is_active"],
        },
        {
          model: CertificateCourse,
          as: "certificates",
          attributes: ["id", "s3_key_certificate", "is_active"],
        },
      ],
    });

    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    // ✅ Desactivar registros anteriores + uploads a S3 todo en paralelo
    const [imageKey, certificateKey, workbookKey] = await Promise.all([
      imageFile
        ? Promise.all([
            course.images?.length > 0
              ? ImageCourses.update(
                  { is_active: false },
                  { where: { courseId: id } },
                )
              : Promise.resolve(),
            uploadToS3("courses", imageFile, `img_${course.id}_${Date.now()}`),
          ]).then(([, key]) => key)
        : Promise.resolve(null),

      certificateFile
        ? Promise.all([
            course.certificates?.length > 0
              ? CertificateCourse.update(
                  { is_active: false },
                  { where: { courseId: id } },
                )
              : Promise.resolve(),
            uploadToS3(
              "certificates",
              certificateFile,
              `cert_${course.id}_${Date.now()}`,
            ),
          ]).then(([, key]) => key)
        : Promise.resolve(null),

      workbookFile
        ? uploadToS3("workbooks", workbookFile, course.id)
        : Promise.resolve(null),
    ]);

    // ✅ Todas las escrituras a BD en paralelo con los keys listos
    const updatePayload = { ...req.body };
    if (workbookKey) updatePayload.workbookUrl = workbookKey;
    if (certificateKey) updatePayload.hasCertificate = true;

    await Promise.all([
      course.update(updatePayload),
      imageKey
        ? ImageCourses.create({
            courseId: course.id,
            s3_key: imageKey,
            is_active: true,
          })
        : Promise.resolve(),
      certificateKey
        ? CertificateCourse.create({
            courseId: course.id,
            s3_key_certificate: certificateKey,
            is_active: true,
          })
        : Promise.resolve(),
    ]);

    // ✅ Query final con attributes explícitos
    const updatedCourse = await Course.findByPk(id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
          attributes: ["s3_key"],
        },
        {
          model: CertificateCourse,
          as: "certificates",
          where: { is_active: true },
          required: false,
          attributes: ["s3_key_certificate"],
        },
      ],
    });

    return res.json({
      ...updatedCourse.toJSON(),
      cover_image_url: updatedCourse.images?.[0]
        ? getS3Url(updatedCourse.images[0].s3_key)
        : null,
      certificate_url: updatedCourse.certificates?.[0]
        ? getS3Url(updatedCourse.certificates[0].s3_key_certificate)
        : null,
      workbook_url: updatedCourse.workbookUrl
        ? getS3Url(updatedCourse.workbookUrl)
        : null,
    });
  } catch (error) {
    console.error("❌ Error al actualizar curso:", error);
    return res.status(500).json({ msg: "Error al actualizar curso" });
  }
};
// Eliminar curso
const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByPk(id);
    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    await course.destroy(); // o soft delete usando isActive = false

    return res.json({ msg: "Curso eliminado" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al eliminar curso" });
  }
};
const downloadCertificate = async (req, res) => {
  try {
    const { userName, courseId } = req.query;

    if (!userName) {
      return res
        .status(400)
        .json({ message: "El nombre del usuario es obligatorio" });
    }

    // 1️⃣ Buscar certificado asociado al curso
    const certificado = await CertificateCourse.findOne({
      where: { courseId },
    });

    if (!certificado) {
      return res
        .status(404)
        .json({ message: "Reconocimiento no encontrado para este curso" });
    }

    const { s3_key_certificate } = certificado;

    // 2️⃣ Obtener URL pública del certificado base
    const pdfUrl = getS3Url(s3_key_certificate);

    // 3️⃣ Descargar el PDF base desde S3
    const existingPdfBytes = await fetch(pdfUrl).then((r) => r.arrayBuffer());
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // ✅ REGISTRAR FONTKIT (Igual que en tu otro código exitoso)
    pdfDoc.registerFontkit(fontkit);

    const pages = pdfDoc.getPages();
    const page = pages[0];

    const { width, height } = page.getSize();

    // ========================================================
    // 🎨 FUENTE CURSIVA PARA NOMBRE CON CENTRADO DINÁMICO
    // ========================================================
    const fontPath = path.join(__dirname, "../fonts/Ephesis-Regular.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const customFont = await pdfDoc.embedFont(fontBytes);

    // 🔧 ÁREA DISPONIBLE PARA EL NOMBRE (Zona segura)
    const nameAreaLeft = 75;
    const nameAreaRight = width - 75;
    const availableWidth = nameAreaRight - nameAreaLeft;

    // Ajustamos la altura vertical donde se pintará en este diploma (280px)
    const yPosition = 280;

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

    // Dibujar el nombre en el PDF con Ephesis-Regular
    page.drawText(userName, {
      x: xCentered,
      y: yPosition,
      size: textSize,
      font: customFont,
      color: rgb(0.0, 0.0, 0.0), // Mantenemos tu color azul de cursos
    });
    // ========================================================

    const pdfBytes = await pdfDoc.save();

    // 5️⃣ Enviar PDF para descarga
    const fileName = `reconocimiento_${userName.replace(/ /g, "_")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("Error generando reconocimiento:", error);
    res.status(500).json({ message: "Error generando reconocimiento" });
  }
};

module.exports = {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
  getCoursesPaginate,
  getNewCourses,
  getCoursesBySystem,
  getTopViewedCourses,
  downloadCertificate,
};
