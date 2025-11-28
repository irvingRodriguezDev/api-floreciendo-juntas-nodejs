const stripe = require("../../config/stripe");

const getBoletos = async (req, res) => {
  try {
    const charges = await stripe.charges.list({
      limit: 100,
      expand: ["data.balance_transaction"],
    });

    const boletos = charges.data.filter(
      (c) => c.metadata?.tipo_pago === "boleto"
    );

    res.json({
      ok: true,
      total: boletos.length,
      boletos,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

const getBoletosResumen = async (req, res) => {
  try {
    const charges = await stripe.charges.list({
      expand: ["data.balance_transaction"],
    });

    const boletos = charges.data.filter(
      (c) => c.metadata?.flow === "VENTA_TICKET"
    );
    const resumen = boletos.reduce(
      (acc, c) => {
        const bt = c.balance_transaction;

        acc.total_bruto += bt.amount / 100;
        acc.total_neto += bt.net / 100;
        acc.total_comisiones += bt.fee / 100;

        return acc;
      },
      { total_bruto: 0, total_neto: 0, total_comisiones: 0 }
    );

    res.json({ ok: true, resumen });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

const getBoletoById = async (req, res) => {
  try {
    const { id } = req.params;

    const charge = await stripe.charges.retrieve(id, {
      expand: ["balance_transaction"],
    });

    if (charge.metadata?.tipo_pago !== "boleto") {
      return res.status(404).json({
        ok: false,
        msg: "El pago no es un boleto",
      });
    }

    res.json({ ok: true, charge });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  getBoletoById,
  getBoletos,
  getBoletosResumen,
};
