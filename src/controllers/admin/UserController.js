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
  const t = await sequelize.transaction();
  try {
    const currentMonth = format(new Date(), "yyyy-MM");

    // 1) Buscar el primer premio disponible (ordenado por id asc)
    const prize = await MonthlyPrize.findOne({
      where: { raffle_month: currentMonth, status: "available" },
      order: [["id", "ASC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!prize) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "No hay premios disponibles para este mes." });
    }

    // 2) Obtener usuarios elegibles (función helper)
    let eligibleUsers = await getEligibleUsers(); // devuelve array de usuarios

    if (!eligibleUsers || eligibleUsers.length === 0) {
      await t.rollback();
      return res
        .status(400)
        .json({ message: "No hay usuarios elegibles para el sorteo." });
    }

    // 3) Excluir ganador del mes anterior
    const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM");
    const lastWinner = await RaffleWinner.findOne({
      where: { raffle_month: lastMonth },
      transaction: t,
    });

    if (lastWinner) {
      eligibleUsers = eligibleUsers.filter((u) => u.id !== lastWinner.user_id);
    }

    // 4) Excluir usuarios que ya ganaron este mes (para evitar multi-ganador en mismo mes)
    const winnersThisMonth = await RaffleWinner.findAll({
      where: { raffle_month: currentMonth },
      attributes: ["user_id"],
      transaction: t,
    });
    const winnersThisMonthIds = winnersThisMonth.map((w) => w.user_id);
    if (winnersThisMonthIds.length > 0) {
      eligibleUsers = eligibleUsers.filter(
        (u) => !winnersThisMonthIds.includes(u.id)
      );
    }

    if (eligibleUsers.length === 0) {
      await t.rollback();
      return res.status(400).json({
        message:
          "Después de aplicar exclusiones no quedan usuarios disponibles para el sorteo.",
      });
    }

    // 5) Elegir 1 ganador al azar
    const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
    const winnerUser = eligibleUsers[randomIndex];

    // 6) Determinar la posición del ganador (cuántos ya han ganado este mes +1)
    const position = winnersThisMonthIds.length + 1;

    // 7) Crear el registro del ganador y marcar el premio como 'awarded' (en la misma transacción)
    const createdWinner = await RaffleWinner.create(
      {
        user_id: winnerUser.id,
        prize_id: prize.id,
        raffle_month: currentMonth,
        position,
      },
      { transaction: t }
    );

    await prize.update({ status: "awarded" }, { transaction: t });

    await t.commit();

    // 8) Responder con info útil para la UI (ruleta/admin)
    return res.status(200).json({
      message: "Ganador seleccionado y premio asignado correctamente",
      winner: {
        id: winnerUser.id,
        name: winnerUser.name,
        email: winnerUser.email,
        total_points: winnerUser.total_points,
      },
      prize: {
        id: prize.id,
        name: prize.prize_name,
      },
      raffle_record: createdWinner,
    });
  } catch (error) {
    await t.rollback();
    console.error(error);
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
