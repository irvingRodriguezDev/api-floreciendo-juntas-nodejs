const stripe = require("../config/stripe");
const { User, Subscription } = require("../models");

const getOrCreateStripeCustomer = async (userId) => {
  // Obtiene usuario en BD
  const user = await User.findByPk(userId);

  if (!user) throw new Error("Usuario no encontrado");

  // Si YA tiene customerId → regresarlo
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // Si no tiene → crear customer en Stripe
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user.id.toString(),
    },
  });

  // Guardar customerId en BD
  user.stripeCustomerId = customer.id;
  await user.save();

  return customer.id;
};
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
    const recurringPrices = [process.env.STRIPE_PRICE_RECURRING]; // puedes agregar más
    const isRecurring = recurringPrices.includes(priceId);
    const mode = isRecurring ? "subscription" : "payment";
    const subscriptionType = isRecurring ? "RECURRING" : "ONETIME";

    // 4. Crear sesión de Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      metadata: {
        userId: userId.toString(),
        priceId,
        subscriptionType,
      },
      client_reference_id: userId.toString(),
      success_url: `${process.env.CLIENT_URL}/success-payment-subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    console.log("Checkout Session creada:", session.id);

    // 5. Guardar registro temporal en DB
    await Subscription.create({
      stripe_checkout_session_id: session.id,
      stripe_customer_id: customerId,
      subscription_type: subscriptionType,
      price_id: priceId,
      userId,
      status: "pending",
    });

    res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Error creando pago:", error);
    res.status(500).json({ msg: "Error creando pago", error: error.message });
  }
};
// Pago único — sin recurrencia
const crearSesionPagoUnico = async (req, res) => {
  try {
    const { userId, priceId } = req.body;

    if (!userId || !priceId) {
      return res.status(400).json({ message: "Faltan parámetros" });
    }

    const customerId = await getOrCreateStripeCustomer(userId);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: false,
      invoice_creation: { enabled: false },

      metadata: {
        userId: userId.toString(),
        priceId,
        subscriptionType: "ONETIME",
        type: "ONETIME",
      },

      client_reference_id: userId.toString(),

      success_url: `${process.env.CLIENT_URL}/success-payment-subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    return res.status(200).json(session);
  } catch (error) {
    console.error("❌ Error en crearSesionPagoUnico:", error);
    return res.status(500).json({
      error: "Error creando la sesión de pago único",
    });
  }
};

// Suscripción mensual con cargos recurrentes controlados
const crearSesionSuscripcionMensual = async (req, res) => {
  try {
    const { userId, priceId } = req.body;

    if (!userId || !priceId) {
      return res.status(400).json({ message: "Faltan parámetros" });
    }

    const customerId = await getOrCreateStripeCustomer(userId);

    const subscriptionType = "RECURRING";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],

      subscription_data: {
        payment_behavior: "allow_incomplete",
        metadata: {
          userId,
          priceId,
          subscriptionType,
        },
      },

      metadata: {
        userId,
        priceId,
        subscriptionType,
        type: "RECURRING",
      },

      client_reference_id: userId.toString(),

      success_url: `${process.env.CLIENT_URL}/success-payment-subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    return res.status(200).json(session);
  } catch (error) {
    console.error("❌ Error en crearSesionSuscripcionMensual:", error);
    return res.status(500).json({
      error: "Error creando la sesión de suscripción mensual",
    });
  }
};

module.exports = {
  createPayment,
  crearSesionPagoUnico,
  crearSesionSuscripcionMensual,
};
