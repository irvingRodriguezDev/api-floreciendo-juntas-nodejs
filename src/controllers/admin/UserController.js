const getS3Url = require("../../helpers/getS3Url");
const { User } = require("../../models");
const { Op } = require("sequelize");
const getAllUsers = async (req, res) => {
  try {
    const allUsers = await User.findAll();

    const formatted = allUsers.map((c) => ({
      ...c.toJSON(),
      profileImageUrl: c.profileImage ? getS3Url(c.profileImage) : null,
    }));
    return res.status(200).json({
      users: formatted,
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
