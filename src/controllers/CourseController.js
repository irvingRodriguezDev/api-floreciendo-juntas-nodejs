const { Course, System, ImageCourses, CourseVideo } = require("../models");
const { Op, json } = require("sequelize");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const deleteFromS3 = require("../helpers/deleteFromS3");
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

    const system = await System.findByPk(system_id);
    if (!system) {
      return res
        .status(404)
        .json({ message: "El sistema especificado no existe" });
    }

    const slug = slugify(title, { lower: true, strict: true });

    const course = await Course.create({
      title,
      slug,
      description,
      level,
      hasCertificate,
      system_id,
    });

    // Subir imagen si se envía
    if (req.file) {
      // 1️⃣ Crear registro de imagen vacío para obtener id
      const imageRecord = await ImageCourses.create({
        courseId: course.id,
        s3_key: "",
        is_active: true,
      });

      // 2️⃣ Subir a S3 usando el id del registro
      const imageKey = await uploadToS3("courses", req.file, imageRecord.id);

      // 3️⃣ Actualizar el registro con la key real
      await imageRecord.update({ s3_key: imageKey });
    }

    // Traer curso con imagen activa
    const createdCourse = await Course.findByPk(course.id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
      ],
    });

    const formatted = {
      ...createdCourse.toJSON(),
      cover_image_url: createdCourse.images?.[0]
        ? getS3Url(createdCourse.images[0].s3_key) + `?t=${Date.now()}`
        : null,
    };

    return res.status(201).json({
      message: "Curso creado correctamente",
      course: formatted,
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
      ],
    });

    // Si quieres ver las imágenes correctamente

    const formatted = courses.map((c) => ({
      ...c.toJSON(),
      cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    res.status(500).json({ msg: "Error al obtener los cursos" });
  }
};
const getNewCourses = async (req, res) => {
  try {
    const courses = await Course.findAll({
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]], // 👈 Ordenar por los más recientes
      limit: 10, // 👈 Solo los 10 más nuevos
    });

    const formatted = courses.map((c) => ({
      ...c.toJSON(),
      cover_image_url: c.images?.[0] ? getS3Url(c.images[0].s3_key) : null,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error("❌ Error al obtener cursos:", error);
    res.status(500).json({ msg: "Error al obtener los cursos" });
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
          required: true, // el curso puede no tener video aún
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
    // Buscar curso con todas sus imágenes
    const course = await Course.findByPk(id, {
      include: [{ model: ImageCourses, as: "images" }],
    });
    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    // Subir nueva imagen si llega archivo
    if (req.file) {
      // Desactivar imágenes actuales
      if (course.images?.length > 0) {
        for (const img of course.images) {
          await img.update({ is_active: false });
        }
      }

      // Crear registro nuevo
      const imageRecord = await ImageCourses.create({
        courseId: course.id,
        s3_key: "",
        is_active: true,
      });

      // Subir a S3 usando el id del registro
      const imageKey = await uploadToS3("courses", req.file, imageRecord.id);

      // Actualizar el registro con la key real
      await imageRecord.update({ s3_key: imageKey });
    }

    // Actualizar otros campos del curso
    await course.update(req.body);

    // Traer curso actualizado con imagen activa
    const updatedCourse = await Course.findByPk(id, {
      include: [
        {
          model: ImageCourses,
          as: "images",
          where: { is_active: true },
          required: false,
        },
      ],
    });

    const formatted = {
      ...updatedCourse.toJSON(),
      cover_image_url: updatedCourse.images?.[0]
        ? getS3Url(updatedCourse.images[0].s3_key)
        : null,
    };

    return res.json(formatted);
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

module.exports = {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
  getCoursesPaginate,
  getNewCourses,
  getCoursesBySystem,
};
