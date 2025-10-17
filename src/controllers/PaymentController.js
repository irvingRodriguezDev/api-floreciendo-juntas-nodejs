const stripe = require("../config/stripe");
const { User, Subscription } = require("../models"); // Importar el nuevo modelo Subscription

const createPayment = async (req, res) => {
  try {
    const { userId, priceId } = req.body;

    // 1. Obtener el usuario y verificar existencia
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    // 2. Lógica para crear o usar el Stripe Customer ID
    let customerId = user.stripe_id;

    if (!customerId) {
      // Si el usuario no tiene un ID de Stripe, créalo ahora
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name, // Asegúrate de usar el campo de nombre correcto
      });
      customerId = customer.id;

      // ¡Importante! Guardar el nuevo ID en tu base de datos
      await user.update({ stripe_id: customerId });
    }

    // 3. Determinar el modo y tipo de suscripción
    const isRecurring = priceId === process.env.STRIPE_PRICE_RECURRING;
    const mode = isRecurring ? "subscription" : "payment";
    const subscriptionType = isRecurring ? "RECURRING" : "ONETIME";

    // 4. Crear la Checkout Session en Stripe
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: mode,
      // === CRÍTICO: METADATA para que el Webhook identifique el usuario y el tipo ===
      metadata: {
        userId: userId.toString(),
        priceId: priceId,
        subscriptionType: subscriptionType,
      },
      client_reference_id: userId.toString(),
      // ==============================================================================
      success_url:
        process.env.CLIENT_URL + "/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: process.env.CLIENT_URL + "/cancel",
    });

    // 5. ¡NUEVO PASO! Crear el registro temporal en tu tabla Subscriptions.
    // Lo marcamos como 'pendiente' o 'creado' hasta que el webhook lo confirme.
    // Esto es útil para rastreo y para evitar que el usuario intente pagar dos veces.
    await Subscription.create({
      stripe_checkout_session_id: session.id, // ID de la sesión de Stripe
      subscription_type: subscriptionType,
      price_id: priceId,
      userId: userId,
      status: "trialing", // Nuevo estado que debes añadir al ENUM de tu modelo
      // Los campos como start_date, end_date, etc., se llenan en el Webhook
    });

    // 6. Devolver la respuesta al frontend
    res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Error creando pago:", error);
    res.status(500).json({ msg: "Error creando pago", error: error.message });
  }
};

module.exports = { createPayment };
