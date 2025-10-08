const { Course } = require("../models");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const createCourse = async (req, res) => {
  try {
    const { title, description, level, thumbnailUrl, hasCertificate } =
      req.body;

    const slug = slugify(title, { lower: true, strict: true });

    let coverImage = null;
    let path = "courses";
    if (req.file) {
      coverImage = await uploadToS3(req.file, path);
    }

    const course = await Course.create({
      title,
      slug,
      description,
      level,
      thumbnailUrl,
      hasCertificate,
      coverImage,
    });

    return res
      .status(201)
      .json({ message: "Curso creado correctamente", course });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ msg: "Error al crear curso", error: error.message });
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
