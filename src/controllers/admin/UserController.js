// controllers/raffleController.js
const { format } = require("date-fns");
const getS3Url = require("../../helpers/getS3Url");
const { User, MonthlyPrize, RaffleWinner } = require("../../models");
const { getEligibleUsers, getTop100Pool } = require("../../helpers/raffle");
const sequelize = require("../../config/db");

const getAllUsers = async (req, res) => {
  try {
    const allUsers = await User.findAll();
    const formatted = allUsers.map((c) => ({
      ...c.toJSON(),
      profileImageUrl: c.profileImage ? getS3Url(c.profileImage) : null,
    }));
    return res.status(200).json({ users: formatted });
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

      // ── 3. Siguiente premio disponible ──────────────────────────────────────
      const prize = monthlyPrizes.find((p) => !awardedIds.includes(p.id));

      if (!prize) {
        throw new Error("Todos los premios de este mes ya fueron entregados.");
      }

      const prizePosition =
        monthlyPrizes.findIndex((p) => p.id === prize.id) + 1;

      // ── 4. Excluir ganadores HISTÓRICOS (Exclusión GLOBAL y absoluta) ───────
      // Eliminamos el filtro 'raffle_month' para que nadie que haya ganado jamás pueda repetir.
      const winnersToExclude = await RaffleWinner.findAll({
        attributes: ["user_id"],
        raw: true,
        transaction: t,
      });

      // Mapeo tolerante a variaciones de nomenclatura por culpa de 'raw: true'
      const excludedIds = winnersToExclude
        .map((w) => w.user_id || w.userId)
        .filter((id) => id !== undefined && id !== null && id !== "");

      // Convertimos a números para operaciones en memoria de forma segura
      const numericExcludedIds = excludedIds.map(Number);

      // ── 5. Seleccionar pool según el tipo de premio ─────────────────────────
      let winnerUser = null;

      if (prize.isPremium) {
        // ────────────────────────────────────────────────────────────────────
        // POOL PREMIUM — Top 100 por puntos (Sorteo Equitativo)
        // ────────────────────────────────────────────────────────────────────
        let top100 = await getTop100Pool({
          excludeIds: numericExcludedIds,
          transaction: t,
        });

        // Escudo secundario en memoria por si el operador SQL falló
        top100 = top100.filter(
          (user) => !numericExcludedIds.includes(Number(user.id)),
        );

        if (!top100.length) {
          throw new Error(
            "No hay usuarios elegibles en el Top 100 para el premio premium.",
          );
        }

        const randomIndex = Math.floor(Math.random() * top100.length);
        winnerUser = top100[randomIndex];
      } else {
        // ────────────────────────────────────────────────────────────────────
        // POOL NORMAL — Sorteo PONDERADO por puntos²
        // ────────────────────────────────────────────────────────────────────
        let eligibleUsersList = await getEligibleUsers({
          excludeIds: numericExcludedIds,
          transaction: t,
        });

        // Escudo secundario en memoria por si el operador SQL falló
        eligibleUsersList = eligibleUsersList.filter(
          (user) => !numericExcludedIds.includes(Number(user.id)),
        );

        if (!eligibleUsersList.length) {
          throw new Error(
            "No hay usuarios elegibles para el sorteo de este premio.",
          );
        }

        // Calcular el total de tickets (puntos²)
        const totalTickets = eligibleUsersList.reduce((sum, user) => {
          const points = user.total_points > 0 ? user.total_points : 1;
          return sum + Math.pow(points, 2);
        }, 0);

        let random = Math.floor(Math.random() * totalTickets);

        for (const user of eligibleUsersList) {
          const points = user.total_points > 0 ? user.total_points : 1;
          const tickets = Math.pow(points, 2);

          if (random < tickets) {
            winnerUser = user;
            break;
          }

          random -= tickets;
        }
      }

      // Failsafe final: Si por algún motivo místico se llegó hasta aquí con un clon, cancelamos
      if (winnerUser && numericExcludedIds.includes(Number(winnerUser.id))) {
        throw new Error(
          `Acción bloqueada: El sistema intentó asignar el premio al usuario ID ${winnerUser.id}, quien ya es un ganador histórico.`,
        );
      }

      if (!winnerUser) {
        throw new Error("No se pudo determinar un ganador.");
      }

      // ── 6. Registrar ganador histórico y actualizar premio ──────────────────
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
          tiktokUsername: winnerUser.tiktokUsername || null,
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
      where: { raffle_month: month },
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "name",
            "email",
            "phone",
            "profileImage",
            "tiktokUsername",
          ],
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
      winners: winners.map((winner) => ({
        position: winner.position,
        user: {
          id: winner.user.id,
          name: winner.user.name,
          email: winner.user.email,
          phone: winner.user.phone,
          profileImageUrl: winner.user.profileImage
            ? getS3Url(winner.user.profileImage)
            : null,
          tiktokUsername: winner.user.tiktokUsername || null,
        },
        prize: {
          id: winner.prize.id,
          name: winner.prize.prize_name,
        },
      })),
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
