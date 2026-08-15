const stripe = require("../config/stripe");
const { User, Subscription } = require("../models");
const { Op } = require("sequelize");
const moment = require("moment-timezone");
/* ================================================= */
/* 🔹 OBTENER O CREAR STRIPE CUSTOMER (ÚNICO)       */
/* ================================================= */
const getOrCreateStripeCustomer = async (user) => {
  if (!user) throw new Error("Usuario no encontrado");

  // 1. Si tiene stripe_id, verificar que aún existe en Stripe
  if (user.stripe_id) {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_id);
      if (!existing.deleted) return user.stripe_id;
      // Si fue eliminado, limpiar y continuar
      await user.update({ stripe_id: null });
    } catch (e) {
      // No existe en Stripe, limpiar y continuar
      await user.update({ stripe_id: null });
    }
  }

  // 2. Buscar en Stripe por email
  const existingCustomers = await stripe.customers.list({
    email: user.email,
    limit: 5, // Traer varios para elegir el más reciente con subs
  });

  if (existingCustomers.data.length > 0) {
    // Preferir el que tenga suscripciones activas, si no el más reciente
    const withSub = existingCustomers.data.find(
      (c) => c.subscriptions?.total_count > 0
    );
    const best = withSub || existingCustomers.data[0];
    await user.update({ stripe_id: best.id });
    return best.id;
  }

  // 3. Crear nuevo
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id.toString() },
  });

  await user.update({ stripe_id: customer.id });
  return customer.id;
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

    // ✅ NUEVO: Verificar en Stripe si ya tiene suscripción vigente
    const subsEnStripe = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const suscripcionVigente = subsEnStripe.data.find((sub) =>
      ["active", "trialing", "past_due"].includes(sub.status)
    );

    if (suscripcionVigente) {
      // Si está past_due, informamos en lugar de cancelar y recrear
      if (suscripcionVigente.status === "past_due") {
        return res.status(400).json({
          msg: "Tienes un pago pendiente. Por favor actualiza tu método de pago.",
          subscriptionId: suscripcionVigente.id,
        });
      }

      // Si está active, simplemente no dejamos crear otra
      return res.status(400).json({
        msg: "Ya tienes una suscripción activa.",
      });
    }

    // ✅ Solo llegamos aquí si NO hay suscripción vigente en Stripe
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
      cancel_url: `${process.env.CLIENT_URL}/pago-interrumpido`,
    });

    // ✅ NO destruyas el registro viejo aquí, solo actualiza o crea
    // El webhook se encargará de actualizar cuando el pago se confirme
    const subExistente = await Subscription.findOne({
      where: { userId: user.id },
    });

    if (subExistente) {
      await subExistente.update({
        stripe_checkout_session_id: session.id,
        status: "pending",
      });
    } else {
      await Subscription.create({
        userId: user.id,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: customerId,
        subscription_type: "RECURRING",
        price_id: priceId,
        status: "pending",
      });
    }

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
      { cancel_at_period_end: true }
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
      { cancel_at_period_end: false }
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
