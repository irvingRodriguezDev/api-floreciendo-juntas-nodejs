const stripe = require("../config/stripe");
const { Order, OrderPayment } = require("../models");
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
    const { amount, type } = req.body;

    if (!["partial", "shipping"].includes(type)) {
      return res.status(400).json({ error: "Tipo de pago inválido" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    /** ──────────────────────────────
     *   🟣 1. PAGO DE ENVÍO
     * ───────────────────────────────
     */
    if (type === "shipping") {
      if (order.shippingPaid) {
        return res.status(400).json({ error: "El envío ya está pagado" });
      }

      if (!order.shippingCost || order.shippingCost <= 0) {
        return res
          .status(400)
          .json({ error: "La orden no tiene envío definido" });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "mxn",
              product_data: { name: `Pago de envío orden #${orderId}` },
              unit_amount: Math.round(order.shippingCost * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          orderId,
          type: "shipping",
          flow: "ORDER_PAYMENT",
        },
        payment_intent_data: {
          metadata: {
            orderId,
            type: "shipping",
            flow: "ORDER_PAYMENT",
          },
        },
        success_url: `${process.env.CLIENT_URL}/shipping-success`,
        cancel_url: `${process.env.CLIENT_URL}/cancel`,
      });

      return res.json({ url: session.url });
    }

    /** ──────────────────────────────
     *   🟣 2. PAGOS PARCIALES
     * ───────────────────────────────
     */

    if (amount === undefined || amount === null || isNaN(amount)) {
      return res
        .status(400)
        .json({ error: "Debes proporcionar un monto numérico." });
    }

    const numericAmount = Number(amount);
    if (numericAmount <= 0) {
      return res.status(400).json({ error: "El monto debe ser mayor a 0." });
    }

    const previousPayments = await OrderPayment.sum("amount", {
      where: { orderId },
    });
    const totalPagado = previousPayments || 0;

    const saldoPendiente = order.totalAmount - totalPagado;

    if (saldoPendiente <= 0) {
      return res
        .status(400)
        .json({ error: "La orden ya está totalmente pagada." });
    }

    if (numericAmount > saldoPendiente) {
      return res.status(400).json({
        error: `El monto excede el saldo pendiente. Restante: $${saldoPendiente}`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `Pago parcial orden #${orderId}` },
            unit_amount: Math.round(numericAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
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

    return res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Error creando pago:", error);
    return res.status(500).json({ error: "Error creando sesión de pago" });
  }
};

module.exports = {
  createInitialPaymentSession,
  createCustomPaymentSession,
};
