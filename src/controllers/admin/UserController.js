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
const { getEligibleUsers, getTop100Pool } = require("../../helpers/raffle");
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
    console.log(error, "error en elegible users");

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
      // ── 1. Obtener TODOS los premios del mes ordenados ──────────────────────
      const monthlyPrizes = await MonthlyPrize.findAll({
        where: { raffle_month: currentMonth },
        order: [["id", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!monthlyPrizes.length) {
        throw new Error("No hay premios creados este mes.");
      }

      // ── 2. Obtener IDs de premios ya entregados ─────────────────────────────
      const awardedIds = monthlyPrizes
        .filter((p) => p.status === "awarded")
        .map((p) => p.id);

      // ── 3. Siguiente premio disponible (en orden de creación) ───────────────
      const prize = monthlyPrizes.find((p) => !awardedIds.includes(p.id));

      if (!prize) {
        throw new Error("Todos los premios de este mes ya fueron entregados.");
      }

      const prizePosition =
        monthlyPrizes.findIndex((p) => p.id === prize.id) + 1;

      // ── 4. Excluir ganadores del mes anterior (exclusión GLOBAL) ────────────
      const winnersToExclude = await RaffleWinner.findAll({
        where: {
          raffle_month: { [Op.in]: [currentMonth, lastMonth] },
        },
        attributes: ["user_id"],
        raw: true,
        transaction: t,
      });

      const excludedIds = winnersToExclude.map((w) => w.user_id);

      // ── 5. Seleccionar pool según isPremium ─────────────────────────────────
      let winnerUser = null;

      if (prize.isPremium) {
        // ────────────────────────────────────────────────────────────────────
        // POOL PREMIUM — Top 100 por puntos del mes
        // Sorteo EQUITATIVO: cada persona tiene la misma probabilidad.
        // Ya ganaron su lugar en el Top 100 por mérito, el azar es parejo.
        // ────────────────────────────────────────────────────────────────────
        const top100 = await getTop100Pool({
          excludeIds: excludedIds,
          transaction: t,
        });

        if (!top100.length) {
          throw new Error(
            "No hay usuarios elegibles en el Top 100 para el premio premium.",
          );
        }

        const randomIndex = Math.floor(Math.random() * top100.length);
        winnerUser = top100[randomIndex];
      } else {
        // ────────────────────────────────────────────────────────────────────
        // POOL NORMAL — todos los suscritos activos
        // Sorteo PONDERADO por puntos²: más puntos = más tickets = más chances.
        // ────────────────────────────────────────────────────────────────────
        const eligibleUsers = await getEligibleUsers({
          excludeIds: excludedIds,
          transaction: t,
        });

        if (!eligibleUsers.length) {
          throw new Error(
            "No hay usuarios elegibles para el sorteo de este premio.",
          );
        }

        // Peso = puntos² (mínimo 1 para no dejar fuera a usuarios sin puntos)
        const totalTickets = eligibleUsers.reduce((sum, user) => {
          const points = user.total_points > 0 ? user.total_points : 1;
          return sum + Math.pow(points, 2);
        }, 0);

        let random = Math.floor(Math.random() * totalTickets);

        for (const user of eligibleUsers) {
          const points = user.total_points > 0 ? user.total_points : 1;
          const tickets = Math.pow(points, 2);

          if (random < tickets) {
            winnerUser = user;
            break;
          }

          random -= tickets;
        }
      }

      if (!winnerUser) {
        throw new Error("No se pudo determinar un ganador.");
      }

      // ── 6. Registrar ganador y marcar premio como entregado ─────────────────
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
          isPremium: prize.isPremium,
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
