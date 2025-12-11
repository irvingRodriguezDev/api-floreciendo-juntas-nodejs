const { MonthlyPrize } = require("../../models");
const { format } = require("date-fns");
const createPrize = async (req, res) => {
  try {
    const { prize_name } = req.body;
    const raffle_month = format(new Date(), "yyyy-MM");

    const prize = await MonthlyPrize.create({ prize_name, raffle_month });

    return res.status(201).json(prize);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const getMonthlyPrizes = async (req, res) => {
  try {
    const raffle_month = format(new Date(), "yyyy-MM");

    const prizes = await MonthlyPrize.findAll({
      where: { raffle_month },
      order: [["id", "ASC"]],
    });

    return res.json(prizes);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const deletePrize = async (req, res) => {
  try {
    const { id } = req.params;
    await MonthlyPrize.destroy({ where: { id } });
    res.json({ message: "Premio eliminado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const availablePrizes = async (req, res) => {
  try {
    const new_month = format(new Date(), "yyyy-MM");
    const prizes = await MonthlyPrize.findAll({
      where: {
        raffle_month: new_month,
        status: "available",
      },
    });

    res.json(prizes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  availablePrizes,
  deletePrize,
  getMonthlyPrizes,
  createPrize,
};
