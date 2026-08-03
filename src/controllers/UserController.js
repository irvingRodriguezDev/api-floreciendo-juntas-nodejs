const dayjs = require("dayjs");
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
      error,
    );
    return res.status(500).json({
      message: "Error al obtener la información",
      error: error.message,
    });
  }
};

const getCompletedCoursesWithImages = async (req, res) => {
  try {
    const { userId, page = 1, limit = 10 } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ message: "Se requiere userId en la query" });
    }

    // 🔹 Cálculo de paginación
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // 🔹 Consulta con paginación
    const { count, rows } = await CourseProgress.findAndCountAll({
      where: {
        userId,
        percent: { [Op.gte]: 95 },
      },
      include: [
        {
          model: Course,
          as: "course",
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
      limit: limitNum,
      offset,
    });

    // 🔹 Formatear respuesta
    const courses = rows
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

    // 🔹 Respuesta con metadatos de paginación
    return res.status(200).json({
      total: count,
      page: pageNum,
      totalPages: Math.ceil(count / limitNum),
      limit: limitNum,
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
