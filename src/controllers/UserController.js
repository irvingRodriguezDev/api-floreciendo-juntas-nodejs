const getS3Url = require("../helpers/getS3Url");
const { CourseProgress, Course, ImageCourses } = require("../models");
const { Op } = require("sequelize");
const countCoursesCompletedByUser = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "Se requiere userId en la query" });
    }

    const coursesCompleted = await CourseProgress.findAll({
      where: {
        userId,
        percent: { [Op.gte]: 95 }, // >= 95%
      },
    });

    return res.status(200).json({
      coursesCompleted: coursesCompleted.length,
    });
  } catch (error) {
    console.error(
      "Error al obtener los cursos completados por usuario:",
      error
    );
    return res.status(500).json({
      message: "Error al obtener la información",
      error: error.message,
    });
  }
};

const getCompletedCoursesWithImages = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "Se requiere userId en la query" });
    }

    // 🔹 Obtener los cursos completados
    const completed = await CourseProgress.findAll({
      where: {
        userId,
        percent: { [Op.gte]: 95 }, // >= 95% completado
      },
      include: [
        {
          model: Course,
          as: "course", // asegúrate que la relación exista: CourseProgress.belongsTo(Course, { as: 'course', foreignKey: 'courseId' })
          include: [
            {
              model: ImageCourses,
              as: "images",
              where: { is_active: true },
              required: false,
            },
          ],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    // 🔹 Formatear la respuesta
    const courses = completed
      .map((c) => {
        const course = c.course?.toJSON();
        if (!course) return null;

        return {
          id: course.id,
          title: course.title,
          cover_image_url: course.images?.[0]
            ? getS3Url(course.images[0].s3_key)
            : null,
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      courses,
    });
  } catch (error) {
    console.error("❌ Error al obtener cursos completados:", error);
    return res.status(500).json({
      message: "Error al obtener cursos completados",
      error: error.message,
    });
  }
};

module.exports = {
  countCoursesCompletedByUser,
  getCompletedCoursesWithImages,
};
