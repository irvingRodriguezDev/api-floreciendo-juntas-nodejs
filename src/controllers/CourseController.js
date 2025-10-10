const { Course, System } = require("../models");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
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

    // Subir imagen usando el id del curso

    // Crear el curso
    const course = await Course.create({
      title,
      slug,
      description,
      level,
      thumbnailUrl,
      hasCertificate,
      system_id,
    });

    // Subir imagen usando el id del curso
    if (req.file) {
      const coverImagePath = await uploadToS3("courses", req.file, course.id);
      course.coverImage = coverImagePath;
      await course.save();
    }
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
    const courses = await Course.findAll();

    const formatted = courses.map((c) => ({
      ...c.toJSON(),
      cover_image_url: getS3Url(c.coverImage),
    }));

    res.json(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener los cursos" });
  }
};

// Obtener un curso por ID
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByPk(id);

    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    res.json({
      ...course.toJSON(),
      cover_image_url: getS3Url(course.coverImage),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener el curso" });
  }
};

// Actualizar curso
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;

    const course = await Course.findByPk(id);
    if (!course) return res.status(404).json({ msg: "Curso no encontrado" });

    let coverImage = course.coverImage; // mantenemos la actual por defecto
    const path = "courses";

    if (req.file) {
      // Si se sube una nueva imagen, la subimos al S3
      const newImage = await uploadToS3(req.file, path);

      // (Opcional) eliminar la imagen anterior si existe
      if (course.coverImage) {
        await deleteFromS3(course.coverImage); // <- si tienes esta función
      }

      coverImage = newImage;
    }

    // Actualizamos el curso
    await course.update({
      ...req.body,
      coverImage, // asignamos la imagen actual o la nueva
    });

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
