const stripe = require("../config/stripe");
const { User } = require("../models");

const createPayment = async (req, res) => {
  try {
    const { userId, type } = req.body; // type = 'one-time' o 'recurring'
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    let session;

    if (type === "recurring") {
      session = await stripe.checkout.sessions.create({
        customer: user.stripe_id,
        payment_method_types: ["card"],
        line_items: [
          {
            price: process.env.STRIPE_PRICE_RECURRING,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url:
          process.env.CLIENT_URL + "/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: process.env.CLIENT_URL + "/cancel",
      });
    } else {
      session = await stripe.checkout.sessions.create({
        customer: user.stripe_id,
        payment_method_types: ["card"],
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ONETIME,
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url:
          process.env.CLIENT_URL + "/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: process.env.CLIENT_URL + "/cancel",
      });
    }

    res.json({ url: session.url, id: session.id, object: session.object });
  } catch (error) {
    res.status(500).json({ msg: "Error creando pago", error: error.message });
  }
};

module.exports = { createPayment };
