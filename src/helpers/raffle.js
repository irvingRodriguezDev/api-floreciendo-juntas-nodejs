// helpers/raffle.js
const { Op } = require("sequelize");
const { User, Subscription } = require("../models");

// ─────────────────────────────────────────────────────────────────────────────
// Pool normal — todas las suscripciones activas
// ─────────────────────────────────────────────────────────────────────────────
const getEligibleUsers = async ({
  excludeIds = [],
  transaction = null,
} = {}) => {
  // Limpiar el array de IDs para asegurar que solo viajen números/IDs válidos
  const cleanExcludeIds = excludeIds
    .map(Number)
    .filter((id) => !isNaN(id) && id !== 0);

  const users = await User.findAll({
    attributes: ["id", "name", "email", "phone", "total_points"],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: true,
        attributes: [], // No aplanamos atributos de suscripción para evitar filas duplicadas con raw: true
        where: {
          status: {
            [Op.in]: ["active", "past_due"],
          },
        },
      },
    ],
    where: {
      roleId: 4,
      ...(cleanExcludeIds.length > 0 && {
        id: { [Op.notIn]: cleanExcludeIds },
      }),
    },
    // Agrupamos única y exclusivamente por el ID del usuario para asegurar unicidad
    group: ["User.id"],
    raw: true,
    transaction,
  });

  return users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Pool premium — Top 100 por puntos del mes actual
// ─────────────────────────────────────────────────────────────────────────────
const getTop100Pool = async ({ excludeIds = [], transaction = null } = {}) => {
  const cleanExcludeIds = excludeIds
    .map(Number)
    .filter((id) => !isNaN(id) && id !== 0);

  const users = await User.findAll({
    subQuery: false, // Evita que Sequelize genere la subquery problemática con el LIMIT y GROUP BY
    attributes: ["id", "name", "email", "phone", "total_points"],
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
      ...(cleanExcludeIds.length > 0 && {
        id: { [Op.notIn]: cleanExcludeIds },
      }),
    },
    group: ["User.id"],
    order: [["total_points", "DESC"]],
    limit: 100, // Ajustado a 100 para cumplir con el Top 100 real
    raw: true,
    transaction,
  });

  return users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));
};

module.exports = { getEligibleUsers, getTop100Pool };
