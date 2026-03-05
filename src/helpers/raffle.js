// helpers/raffle.js
const { Op, fn, col, literal } = require("sequelize");
const { User, Subscription } = require("../models");

const getEligibleUsers = async ({
  excludeIds = [],
  transaction = null,
} = {}) => {
  const users = await User.findAll({
    attributes: [
      "id",
      "name",
      "email",
      "phone",
      "total_points",
      [fn("COUNT", col("subscriptions.id")), "subscriptionCount"],
    ],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: true,
        attributes: [],
        where: {
          status: {
            [Op.in]: ["active", "past_due"],
          },
        },
      },
    ],
    where: {
      roleId: 4,
      ...(excludeIds.length > 0 && {
        id: {
          [Op.notIn]: excludeIds,
        },
      }),
    },
    group: ["User.id"],
    having: literal("COUNT(subscriptions.id) = 1"),
    raw: true,
    transaction,
  });

  return users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));
};

module.exports = { getEligibleUsers };
