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
      metadata: {
        orderId,
        type: "initial",
        flow: "ORDER_PAYMENT",
      },

      // 👇 Aquí es donde realmente se aplican estas reglas
      // automatic_payment_methods: { enabled: false }, // ❌ No permitir métodos automáticos
      // setup_future_usage: null, // ❌ NO guardar tarjeta
      payment_intent_data: {
        metadata: {
          orderId,
          type: "initial",
          flow: "ORDER_PAYMENT",
        },
      },

      success_url: `${process.env.CLIENT_URL}/success-payment-partial`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
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

      // 👇 Esto garantiza que NO haya reintentos automáticos
      // setup_future_usage: null, // ❌ No guardar tarjeta
      // automatic_payment_methods: { enabled: false }, // ❌ No usar métodos automáticos
      metadata: {
        orderId,
        type: "partial",
        flow: "ORDER_PAYMENT",
      },

      payment_intent_data: {
        metadata: {
          orderId,
          type: "partial",
          flow: "ORDER_PAYMENT",
        },
      },

      success_url: `${process.env.CLIENT_URL}/success-payment-partial`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
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
