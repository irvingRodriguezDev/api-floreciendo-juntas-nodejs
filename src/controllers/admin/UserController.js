const { User } = require("../../models");
const { Op } = require("sequelize");
const getAllUsers = async (req, res) => {
  try {
    const allUsers = await User.findAll();

    return res.status(200).json({
      users: allUsers,
    });
  } catch (error) {
    console.error("Error al obtener los usuarios:", error);
    return res.status(500).json({
      message: "Error al obtener la información",
      error: error.message,
    });
  }
};

module.exports = {
  getAllUsers,
};
