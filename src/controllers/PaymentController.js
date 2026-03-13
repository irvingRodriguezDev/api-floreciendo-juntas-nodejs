const stripe = require("../config/stripe");
const { User, Subscription } = require("../models");
const { Op } = require("sequelize");
const moment = require("moment-timezone");
/* ================================================= */
/* 🔹 OBTENER O CREAR STRIPE CUSTOMER (ÚNICO)       */
/* ================================================= */
const getOrCreateStripeCustomer = async (user) => {
  if (!user) throw new Error("Usuario no encontrado");

  // 1. Si ya tenemos el ID, lo usamos
  if (user.stripe_id) return user.stripe_id;

  // 2. Opcional: Buscar en Stripe por email para evitar duplicados históricos
  const existingCustomers = await stripe.customers.list({
    email: user.email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    const stripeId = existingCustomers.data[0].id;
    await user.update({ stripe_id: stripeId });
    return stripeId;
  }

  // 3. Si no existe en ningún lado, lo creamos
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id.toString() },
  });

  await user.update({ stripe_id: customer.id });
  return customer.id;
};
const limpiarSuscripcionesPrevias = async (customerId) => {
  // Traemos todas las suscripciones del cliente, sin importar el estado
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  // Cancelamos todo lo que no esté ya cancelado
  for (const sub of subs.data) {
    if (sub.status !== "canceled") {
      await stripe.subscriptions.cancel(sub.id);
      console.log(
        `✅ Suscripción previa ${sub.id} cancelada para evitar conflictos.`,
      );
    }
  }
};

/* ================================================= */
/* 🔹 CREAR O REACTIVAR SUSCRIPCIÓN MENSUAL         */
/* ================================================= */
const crearSesionSuscripcionMensual = async (req, res) => {
  try {
    const { userId, priceId } = req.body;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const customerId = await getOrCreateStripeCustomer(user);

    // 1️⃣ MEJORA: Limpiamos Stripe antes de crear algo nuevo
    await limpiarSuscripcionesPrevias(customerId);

    // 2️⃣ CREAR CHECKOUT SESSION (Ya no hay riesgo de duplicados)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { userId: user.id.toString(), priceId },
      },
      metadata: { userId: user.id.toString(), priceId },
      success_url: `${process.env.CLIENT_URL}/success-payment-subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    // 3️⃣ UPSERT EN TU DB (Limpia el status local)
    await Subscription.destroy({ where: { userId: user.id } }); // Borramos registro viejo
    await Subscription.create({
      userId: user.id,
      stripe_checkout_session_id: session.id,
      stripe_customer_id: customerId,
      subscription_type: "RECURRING",
      price_id: priceId,
      status: "pending",
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("❌ Error en flujo de suscripción:", error.message);
    return res.status(400).json({ msg: error.message });
  }
};

/* ================================================= */
/* 🔹 CANCELAR SUSCRIPCIÓN (SUAVE)                  */
/* ================================================= */
const cancelSubscription = async (req, res) => {
  try {
    const { userId } = req.body;

    // Buscamos la suscripción activa
    const subscription = await Subscription.findOne({
      where: {
        userId,
        status: ["active", "past_due"], // Importante incluir past_due por si quiere cancelar algo que no pudo pagar
      },
    });

    if (!subscription || !subscription.stripe_subscription_id) {
      return res.status(400).json({
        message: "No se encontró una suscripción activa para cancelar.",
      });
    }

    // 1. Notificamos a Stripe que no renueve al final del periodo
    const stripeResponse = await stripe.subscriptions.update(
      subscription.stripe_subscription_id,
      { cancel_at_period_end: true },
    );

    // 2. Actualizamos nuestra BD SIN quitar el acceso todavía
    // Marcamos que se cancelará, pero el status sigue siendo el de Stripe (active)
    await subscription.update({
      // No cambies status a "canceled" aquí, deja que el WEBHOOK lo haga cuando expire de verdad
      will_cancel_at: moment
        .unix(stripeResponse.cancel_at)
        .tz("America/Mexico_City")
        .toDate(),
    });

    return res.status(200).json({
      message:
        "Tu suscripción ha sido cancelada. Seguirás teniendo acceso hasta el final del periodo pagado.",
      expiresAt: stripeResponse.cancel_at_period_end
        ? moment.unix(stripeResponse.current_period_end).format("LL")
        : null,
    });
  } catch (error) {
    console.error("❌ Error cancelando:", error.message);
    return res
      .status(500)
      .json({ message: "Error interno al procesar cancelación" });
  }
};

const reactivateSubscription = async (req, res) => {
  try {
    const userId = req.user.id; // ✅ Siempre del token

    const subscription = await Subscription.findOne({
      where: {
        userId,
        status: "active",
        will_cancel_at: { [Op.ne]: null }, // ✅ Query más precisa
      },
    });

    if (!subscription) {
      return res.status(400).json({
        message: "No tienes una cancelación programada para reactivar.",
      });
    }

    const stripeResponse = await stripe.subscriptions.update(
      subscription.stripe_subscription_id,
      { cancel_at_period_end: false },
    );

    const nextRenewalDate = moment
      .unix(stripeResponse.current_period_end)
      .toDate();

    await subscription.update({
      status: "active",
      will_cancel_at: null,
      next_renewal: nextRenewalDate,
      ended_at: null,
    });

    return res.status(200).json({
      message:
        "¡Membresía reactivada con éxito! Tu acceso continuará sin interrupciones.",
      next_billing_date: moment(nextRenewalDate).format("LL"),
    });
  } catch (error) {
    console.error("❌ Error al reactivar:", error);

    if (error.type === "StripeInvalidRequestError") {
      // ✅ Error real de Stripe
      return res.status(400).json({
        message:
          "La suscripción ya ha expirado o no es válida. Por favor, adquiere un nuevo plan.",
      });
    }

    return res.status(500).json({
      message: "Ocurrió un error interno al intentar reactivar tu suscripción.",
    });
  }
};

module.exports = {
  crearSesionSuscripcionMensual,
  cancelSubscription,
  reactivateSubscription,
};
