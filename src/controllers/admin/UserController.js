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
      // 1️⃣ Obtener TODOS los premios del mes ordenados
      const monthlyPrizes = await MonthlyPrize.findAll({
        where: {
          raffle_month: currentMonth,
        },
        order: [["id", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!monthlyPrizes.length) {
        throw new Error("No hay premios creados este mes.");
      }

      // 2️⃣ Obtener premios ya entregados
      const awardedPrizes = await MonthlyPrize.findAll({
        where: {
          raffle_month: currentMonth,
          status: "awarded",
        },
        transaction: t,
      });

      const awardedIds = awardedPrizes.map((p) => p.id);

      // 3️⃣ Obtener siguiente premio disponible por ORDEN REAL
      const prize = monthlyPrizes.find((p) => !awardedIds.includes(p.id));

      if (!prize) {
        throw new Error("No hay premios disponibles para este mes.");
      }

      // 🔥 POSICIÓN REAL DEL PREMIO (1–13)
      const prizePosition =
        monthlyPrizes.findIndex((p) => p.id === prize.id) + 1;

      // 4️⃣ Excluir ganadores mes actual y anterior
      const winnersToExclude = await RaffleWinner.findAll({
        where: {
          raffle_month: {
            [Op.in]: [currentMonth, lastMonth],
          },
        },
        attributes: ["user_id"],
        raw: true,
        transaction: t,
      });

      const excludedIds = winnersToExclude.map((w) => w.user_id);

      // 5️⃣ Obtener elegibles correctamente
      const eligibleUsers = await getEligibleUsers({
        excludeIds: excludedIds,
        transaction: t,
      });

      if (!eligibleUsers.length) {
        throw new Error("No hay usuarios elegibles.");
      }

      let winnerUser = null;

      const sortedByPoints = [...eligibleUsers].sort(
        (a, b) => b.total_points - a.total_points,
      );

      const top3 = sortedByPoints.slice(0, 3);
      const nonTop3 = sortedByPoints.slice(3);

      // 🎰 PREMIOS 1–10
      if (prizePosition <= 10) {
        if (!nonTop3.length) {
          throw new Error("No hay suficientes usuarios fuera del top 3.");
        }

        const totalTickets = nonTop3.reduce((sum, user) => {
          const points = user.total_points > 0 ? user.total_points : 1;
          return sum + Math.pow(points, 2);
        }, 0);

        let random = Math.floor(Math.random() * totalTickets);

        for (const user of nonTop3) {
          const points = user.total_points > 0 ? user.total_points : 1;
          const tickets = Math.pow(points, 2);

          if (random < tickets) {
            winnerUser = user;
            break;
          }

          random -= tickets;
        }
      } else {
        // 🏆 PREMIOS 11–13 → SOLO TOP 3
        if (!top3.length) {
          throw new Error("No hay usuarios en el top 3.");
        }

        winnerUser = top3[0];
      }

      if (!winnerUser) {
        throw new Error("No se pudo determinar ganador.");
      }

      // 6️⃣ Registrar ganador
      const winnersCount = await RaffleWinner.count({
        where: { raffle_month: currentMonth },
        transaction: t,
      });

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
          total_points: winnerUser.total_points,
        },
        prize: {
          id: prize.id,
          name: prize.prize_name,
          position: prizePosition,
        },
        raffle_record: createdWinner,
      };
    });

    return res.status(200).json({
      message: "¡Ganador seleccionado correctamente!",
      ...finalResult,
    });
  } catch (error) {
    console.error("❌ Error en runRaffleOneWinner:", error);
    return res.status(500).json({ error: error.message });
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
