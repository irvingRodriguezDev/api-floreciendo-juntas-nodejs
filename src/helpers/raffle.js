// helpers/raffle.js
// Dos pools de participantes:
//   getEligibleUsers   → pool normal  (todas las suscripciones activas)
//   getTop100Pool      → pool premium (Top 100 por puntos del mes, sin ganadores recientes)

const { Op, fn, col, literal } = require("sequelize");
const { User, Subscription } = require("../models");

// ─────────────────────────────────────────────────────────────────────────────
// Pool normal — todas las suscripciones activas, excluyendo ganadores globales
// ─────────────────────────────────────────────────────────────────────────────
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
        id: { [Op.notIn]: excludeIds },
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

// ─────────────────────────────────────────────────────────────────────────────
// Pool premium — Top 100 por puntos del mes actual, excluyendo ganadores globales
//
// IMPORTANTE: cuando implementes user_points_monthly, cambia el ORDER BY
// a los puntos del mes en curso en lugar de total_points.
// Por ahora usa total_points como aproximación hasta tener esa tabla.
// ─────────────────────────────────────────────────────────────────────────────
const getTop100Pool = async ({ excludeIds = [], transaction = null } = {}) => {
  const users = await User.findAll({
    subQuery: false, // ← evita que Sequelize genere la subquery problemática
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
        id: { [Op.notIn]: excludeIds },
      }),
    },
    group: ["User.id"],
    having: literal("COUNT(subscriptions.id) = 1"),
    order: [["total_points", "DESC"]],
    limit: 30,
    raw: true,
    transaction,
  });

  return users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));
};
module.exports = { getEligibleUsers, getTop100Pool };
