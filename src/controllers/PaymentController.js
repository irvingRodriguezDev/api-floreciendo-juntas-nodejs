const stripe = require("../config/stripe");
const { User, Subscription } = require("../models");

const createPayment = async (req, res) => {
  try {
    const { userId, priceId } = req.body;

    // 1. Validar usuario
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    // 2. Crear Stripe Customer si no existe
    let customerId = user.stripe_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      customerId = customer.id;
      await user.update({ stripe_id: customerId });
      console.log("Cliente Stripe creado:", customerId);
    }

    // 3. Determinar modo
    const isRecurring = priceId === process.env.STRIPE_PRICE_RECURRING;
    const mode = isRecurring ? "subscription" : "payment";
    const subscriptionType = isRecurring ? "RECURRING" : "ONETIME";

    // 4. Crear sesión de Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: mode,
      metadata: {
        userId: userId.toString(),
        priceId,
        subscriptionType,
      },
      client_reference_id: userId.toString(),
      success_url:
        process.env.CLIENT_URL + "/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: process.env.CLIENT_URL + "/cancel",
    });

    console.log("Checkout Session creada:", session.id);

    // 5. Guardar registro temporal en DB
    await Subscription.create({
      stripe_checkout_session_id: session.id,
      subscription_type: subscriptionType,
      price_id: priceId,
      userId: userId,
      status: "pending", // estado inicial seguro
    });

    res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Error creando pago:", error);
    res.status(500).json({ msg: "Error creando pago", error: error.message });
  }
};

module.exports = { createPayment };
