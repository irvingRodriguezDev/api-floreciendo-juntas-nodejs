const { User, Role } = require("../models");

const checkRole = (rolesPermitidos) => {
  return async (req, res, next) => {
    try {
      const user = await User.findByPk(req.user.id, {
        include: { model: Role, as: "role" },
      });

      if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

      if (!rolesPermitidos.includes(user.roleId)) {
        return res
          .status(403)
          .json({ msg: "No tienes permisos para esta acción" });
      }

      next();
    } catch (error) {
      res
        .status(500)
        .json({ msg: "Error en autorización", error: error.message });
    }
  };
};

module.exports = checkRole;
