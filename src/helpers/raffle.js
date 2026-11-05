// helpers/raffle.js
const { Op } = require("sequelize");
const { User, Subscription } = require("../models");
const sequelize = require("../config/db");
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
    attributes: [
      "id",
      "name",
      "email",
      "phone",
      "total_points",
      "tiktokUsername",
    ],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: true,
        attributes: [], // No aplanamos atributos de suscripción para evitar filas duplicadas con raw: true
        where: {
          status: {
            [Op.in]: ["active"],
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
    attributes: [
      "id",
      "name",
      "email",
      "phone",
      "total_points",
      "tiktokUsername",
    ],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: true,
        attributes: [],
        where: {
          status: {
            [Op.in]: ["active"],
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
    limit: 10, // Ajustado a 100 para cumplir con el Top 100 real
    raw: true,
    transaction,
  });

  return users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));
};

const getEligibleUsersAndDrawWinners = async ({
  excludeIds = [],
  startDate = "2026-01-20 15:00:00",
  endDate = "2026-02-28 11:59:59",
  transaction = null,
} = {}) => {
  // 1. Limpiar IDs a excluir
  const cleanExcludeIds = excludeIds
    .map(Number)
    .filter((id) => !isNaN(id) && id !== 0);

  // 2. Obtener todos los usuarios elegibles aplicando tus reglas de fechas, rol y suscripción activa
  const users = await User.findAll({
    subQuery: false,
    attributes: [
      "id",
      "name",
      "email",
      "phone",
      "total_points",
      "tiktokUsername",
      [
        sequelize.fn("MAX", sequelize.col("subscriptions.createdAt")),
        "subscriptionCreatedAt",
      ],
    ],
    include: [
      {
        model: Subscription,
        as: "subscriptions",
        required: true,
        attributes: [],
        where: {
          status: "active",
          // Filtro de fecha de creación/pago de la suscripción
          createdAt: {
            [Op.between]: [startDate, endDate],
          },
        },
      },
    ],
    where: {
      roleId: 4,
      // Filtro de fecha de registro del usuario
      createdAt: {
        [Op.between]: [startDate, endDate],
      },
      ...(cleanExcludeIds.length > 0 && {
        id: { [Op.notIn]: cleanExcludeIds },
      }),
    },
    group: ["User.id"],
    order: [["total_points", "DESC"]], // Ordenados de mayor a menor puntaje
    raw: true,
    transaction,
  });

  // Limpiar y formatear puntos
  const formattedUsers = users.map((u) => ({
    ...u,
    total_points: Number(u.total_points) || 0,
  }));

  // 3. Seleccionar los 2 ganadores de PREMIO PREMIUM (los 2 con más puntos del listado ordenado)
  const premiumWinners = formattedUsers.slice(0, 2);

  // Obtener los IDs de los ganadores premium para no repetirlos en el sorteo normal
  const premiumIds = premiumWinners.map((w) => w.id);

  // 4. Crear el pool restante para los PREMIOS NORMALES (al azar)
  const remainingPool = formattedUsers.filter(
    (u) => !premiumIds.includes(u.id),
  );

  return {
    totalEligible: formattedUsers.length,
    premiumWinners: premiumWinners, // Los 2 con más puntos
    remainingPool: remainingPool, // Pool limpio para sortear los 10 premios restantes al azar
  };
};

module.exports = {
  getEligibleUsers,
  getTop100Pool,
  getEligibleUsersAndDrawWinners,
};
