const { Course, System } = require("../models");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const createCourse = async (req, res) => {
  try {
    const {
      title,
      description,
      level,
      thumbnailUrl,
      hasCertificate,
      system_id, // 👈 nuevo campo
    } = req.body;

    // Validar campos obligatorios
    if (!title || !description || !system_id) {
      return res.status(400).json({
        message:
          "Los campos 'title', 'description' y 'system_id' son obligatorios",
      });
    }

    // Verificar que el sistema exista
    const system = await System.findByPk(system_id);
    if (!system) {
      return res
        .status(404)
        .json({ message: "El sistema especificado no existe" });
    }

    // Generar el slug
    const slug = slugify(title, { lower: true, strict: true });

    // Subir imagen de portada (si existe)
    let coverImage = null;
    const path = "courses";
    if (req.file) {
      coverImage = await uploadToS3(req.file, path);
    }

    // Crear el curso
    const course = await Course.create({
      title,
      slug,
      description,
      level,
      thumbnailUrl,
      hasCertificate,
      coverImage,
      system_id, // 👈 se guarda la relación
    });

    return res.status(201).json({
      message: "Curso creado correctamente",
      course,
    });
  } catch (error) {
    console.error("Error al crear curso:", error);
    return res.status(500).json({
      message: "Error al crear curso",
      error: error.message,
    });
  }
};

// Listar todos los cursos
const getCourses = async (req, res) => {
  try {
    const courses = await Course.findAll({
      where: { isActive: true },
    });
    return res.json(courses);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al obtener cursos" });
  }
};

// Obtener curso por id
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByPk(id, {
      include: ["video", "reviews", "posts", "progresses"],
    });
    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });
    return res.json(course);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al obtener curso" });
  }
};

// Actualizar curso
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByPk(id);
    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    await course.update(req.body);

    return res.json(course);
  } catch (error) {
    console.error(error);
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
};
