const stripe = require("../config/stripe");
const { Order } = require("../models");
const createInitialPaymentSession = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const amountToPay = order.totalAmount * 0.1; // 💰 10%
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: {
              name: `Pago inicial del 10% de la orden #${orderId}`,
            },
            unit_amount: Math.round(amountToPay * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/success`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
      metadata: { orderId },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Error creando sesión de pago:", error);
    res.status(500).json({ error: "Error creando sesión de pago" });
  }
};
const createCustomPaymentSession = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount } = req.body; // 💰 monto libre, ej. 50, 100, 300

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const today = new Date();
    if (today > new Date(order.dueDate))
      return res
        .status(400)
        .json({ error: "No puedes pagar después de la fecha límite" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: {
              name: `Pago parcial de la orden #${orderId}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/success`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
      metadata: { orderId },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Error creando sesión de pago:", error);
    res.status(500).json({ error: "Error creando sesión de pago" });
  }
};

module.exports = {
  createInitialPaymentSession,
  createCustomPaymentSession,
};
