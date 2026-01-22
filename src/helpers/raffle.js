// helpers/raffle.js
const { Op } = require("sequelize");
const { User, Subscription, PointEvent } = require("../models");

const getEligibleUsers = async () => {
  const users = await User.findAll({
    attributes: ["id", "name", "email", "total_points", "phone"],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: false,
        attributes: ["status"],
      },
      {
        model: PointEvent,
        as: "points_history",
        required: false,
        attributes: ["id"],
      },
    ],
    where: {
      id: {
        [Op.ne]: 2, // 👈 excluye al usuario con id 2
      },
      [Op.or]: [
        { "$subscriptions.status$": "active" },
        { "$points_history.id$": { [Op.ne]: null } },
      ],
    },
    group: ["User.id"],
  });

  return users;
};

module.exports = { getEligibleUsers };
