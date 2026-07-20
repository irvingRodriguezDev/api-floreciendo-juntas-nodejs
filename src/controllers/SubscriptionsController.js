const stripe = require("../config/stripe");
const { Subscription } = require("../models");
const User = require("../models/User");

const listSubscriptionsActive = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const parsedLimit = parseInt(limit, 10) || 10;
    const parsedPage = parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    // Cambiamos a findAndCountAll para obtener el total global de coincidencias
    const { count: totalItems, rows: activeSubscriptions } =
      await Subscription.findAndCountAll({
        include: [
          {
            model: User,
            attributes: ["id", "name", "email", "roleId"],
            where: { roleId: 4 }, // Solo usuarios con roleId 4
          },
        ],
        attributes: [
          "id",
          "stripe_subscription_id",
          "stripe_customer_id",
          "start_date",
          "next_renewal",
          "status",
          "updatedAt",
        ],
        where: { status: "active" },
        limit: parsedLimit,
        offset: offset,
        order: [["updatedAt", "ASC"]],
      });

    // Calculamos el total de páginas
    const totalPages = Math.ceil(totalItems / parsedLimit);

    return res.status(200).json({
      message: "Active subscriptions fetched successfully.",
      pagination: {
        totalItems, // Total de registros en toda la base de datos con esos filtros
        totalPages, // Total de páginas disponibles
        currentPage: parsedPage, // Página actual
        perPage: parsedLimit, // Límite por página
      },
      subscriptions: activeSubscriptions, // Los registros de la página actual
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: "An error occurred while fetching active subscriptions.",
    });
  }
};

const listSubscriptionsPastDue = async (req, res) => {
  try {
    // 1. Extraemos y parseamos los parámetros de paginación
    const { page = 1, limit = 10 } = req.query;
    const parsedLimit = parseInt(limit, 10) || 10;
    const parsedPage = parseInt(page, 10) || 1;
    const offset = (parsedPage - 1) * parsedLimit;

    // 2. Cambiamos a findAndCountAll para obtener filas y el total global
    const { count: totalItems, rows: pastDueSubscriptions } =
      await Subscription.findAndCountAll({
        include: [
          {
            model: User,
            attributes: ["id", "name", "email", "phone", "roleId"],
            where: { roleId: 4 }, // Solo usuarios con roleId 4
          },
        ],
        attributes: [
          "id",
          "stripe_subscription_id",
          "stripe_customer_id",
          "start_date",
          "next_renewal",
          "status",
          "updatedAt",
        ],
        where: { status: "past_due" },
        limit: parsedLimit,
        offset: offset,
        order: [["updatedAt", "DESC"]], // Trae primero las que cambiaron a past_due más recientemente
      });

    // 3. Calculamos el total de páginas
    const totalPages = Math.ceil(totalItems / parsedLimit);

    // 4. Respondemos con la estructura estandarizada
    return res.status(200).json({
      message: "Past due subscriptions fetched successfully.",
      totalItems,
      totalPages,
      currentPage: parsedPage,
      perPage: parsedLimit,
      subscriptions: pastDueSubscriptions,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: "An error occurred while fetching past due subscriptions.",
    });
  }
};

module.exports = {
  listSubscriptionsActive,
  listSubscriptionsPastDue,
};
