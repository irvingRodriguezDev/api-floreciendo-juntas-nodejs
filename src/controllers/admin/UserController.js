const { format, subMonths } = require("date-fns");
const getS3Url = require("../../helpers/getS3Url");
const {
  User,
  Subscription,
  PointEvent,
  MonthlyPrize,
  RaffleWinner,
  Address,
} = require("../../models");
const { getEligibleUsers } = require("../../helpers/raffle");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const { response } = require("express");
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
const eligibleUsers = async (req, res) => {
  try {
    const users = await getEligibleUsers();
    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
const runRaffleOneWinner = async (req, res) => {
  const now = new Date();
  const currentMonth = format(now, "yyyy-MM");
  const lastMonth = format(subMonths(now, 1), "yyyy-MM");

  try {
    let finalResult;

    await sequelize.transaction(async (t) => {
      // 1. OBTENER PREMIO ALEATORIO
      // Usamos RAND() para MySQL/MariaDB o RANDOM() para PostgreSQL
      const prize = await MonthlyPrize.findOne({
        where: { raffle_month: currentMonth, status: "available" },
        order: [sequelize.literal("RAND()")], // 👈 Esto hace que el premio sea al azar
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!prize) {
        const error = new Error("No hay premios disponibles para este mes.");
        error.name = "BusinessError";
        throw error;
      }

      // 2. Obtener excluidos
      const winnersToExclude = await RaffleWinner.findAll({
        where: { raffle_month: [currentMonth, lastMonth] },
        attributes: ["user_id"],
        transaction: t,
        raw: true,
      });
      const excludedIds = winnersToExclude.map((w) => w.user_id);

      // 3. Obtener usuarios elegibles
      let eligibleUsers = await getEligibleUsers({
        transaction: t,
        excludeIds: excludedIds,
      });

      if (!eligibleUsers || eligibleUsers.length === 0) {
        const error = new Error(
          "No hay usuarios elegibles tras aplicar exclusiones.",
        );
        error.name = "BusinessError";
        throw error;
      }

      // 4. Selección azarosa del ganador
      const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
      const winnerUser = eligibleUsers[randomIndex];

      // 5. DOBLE VERIFICACIÓN (Guardia de seguridad)
      // Verificamos que no haya ganado ya en este mes justo antes de insertar
      const alreadyWon = await RaffleWinner.findOne({
        where: { user_id: winnerUser.id, raffle_month: currentMonth },
        transaction: t,
      });

      if (alreadyWon) {
        const error = new Error(
          "El usuario seleccionado ya ganó en este ciclo.",
        );
        error.name = "BusinessError";
        throw error;
      }

      // 6. Determinar posición
      const winnersCount = await RaffleWinner.count({
        where: { raffle_month: currentMonth },
        transaction: t,
      });

      // 7. Escritura
      const createdWinner = await RaffleWinner.create(
        {
          user_id: winnerUser.id,
          prize_id: prize.id,
          raffle_month: currentMonth,
          position: winnersCount + 1,
        },
        { transaction: t },
      );

      await prize.update({ status: "awarded" }, { transaction: t });

      finalResult = {
        winner: {
          id: winnerUser.id,
          name: winnerUser.name,
          email: winnerUser.email,
        },
        prize: { id: prize.id, name: prize.prize_name },
        raffle_record: createdWinner,
      };
    });

    return res.status(200).json({
      message: "¡Ganador y premio seleccionados aleatoriamente!",
      ...finalResult,
    });
  } catch (error) {
    console.error("❌ Error en runRaffleOneWinner:", error);
    if (error.name === "BusinessError") {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ error: "Error interno en el sorteo" });
  }
};

const obtainWinnersOfMonth = async (req, res) => {
  try {
    const { month } = req.query;

    const winners = await RaffleWinner.findAll({
      where: {
        raffle_month: month,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "email", "phone"],
        },
        {
          model: MonthlyPrize,
          as: "prize",
          attributes: ["id", "prize_name"],
        },
      ],
      order: [["position", "ASC"]],
    });

    return res.status(200).json({
      month: month,
      totalWinners: winners.length,
      winners,
    });
  } catch (error) {
    console.error("obtainWinnersOfMonth error:", error);
    return res.status(500).json({
      message: "Error al obtener los ganadores del mes",
    });
  }
};

module.exports = {
  getAllUsers,
  runRaffleOneWinner,
  eligibleUsers,
  obtainWinnersOfMonth,
};
