const { CourseProgress } = require("../models");
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

module.exports = {
  countCoursesCompletedByUser,
};
