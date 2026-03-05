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

/* ================================================= */
/* 🔹 CREAR O REACTIVAR SUSCRIPCIÓN MENSUAL         */
/* ================================================= */
const crearSesionSuscripcionMensual = async (req, res) => {
  try {
    const { userId, priceId } = req.body;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    // 1️⃣ Aseguramos que usamos el stripe_id guardado en User para evitar duplicados
    const customerId = await getOrCreateStripeCustomer(user);

    // 2️⃣ BUSCAR SUSCRIPCIONES (Active o Past_due)
    // Filtramos por estado para no traer suscripciones canceladas antiguas
    const stripeSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    // También buscamos si tiene alguna en past_due para invitarlo a pagar la existente
    // en lugar de crear una nueva
    const pastDueSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "past_due",
      limit: 1,
    });

    const currentSub = stripeSubs.data[0];
    const overdueSub = pastDueSubs.data[0];

    // CASO A: Ya tiene una suscripción ACTIVA
    if (currentSub) {
      if (!currentSub.cancel_at_period_end) {
        return res
          .status(400)
          .json({ msg: "Ya tienes una suscripción activa y vigente." });
      }

      // Si está activa pero marcada para cancelar (periodo de gracia), la reactivamos
      await stripe.subscriptions.update(currentSub.id, {
        cancel_at_period_end: false,
      });

      await Subscription.upsert({
        userId: user.id,
        stripe_subscription_id: currentSub.id,
        stripe_customer_id: customerId,
        status: "active",
      });

      return res.status(200).json({
        msg: "Tu suscripción ha sido reactivada exitosamente.",
        reactivated: true,
      });
    }

    // CASO B: Tiene una suscripción PAST_DUE (El problema que tenías)
    // En lugar de crear una nueva suscripción, lo ideal es mandarlo al "Customer Portal"
    // o que pague la factura pendiente. Para simplificar, si hay una past_due,
    // la cancelamos antes de crear la nueva para evitar cobros dobles futuros.
    if (overdueSub) {
      await stripe.subscriptions.cancel(overdueSub.id);
      // Opcional: Podrías marcarla como cancelada en tu DB también
    }

    // 3️⃣ CREAR CHECKOUT SESSION
    const session = await stripe.checkout.sessions.create({
      customer: customerId, // Usamos el ID existente
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      // IMPORTANTE: Pasar los metadatos también a la suscripción
      subscription_data: {
        metadata: {
          userId: user.id.toString(),
          priceId: priceId.toString(),
        },
      },
      metadata: {
        userId: user.id.toString(),
        priceId: priceId.toString(),
      },
      success_url: `${process.env.CLIENT_URL}/success-payment-subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    // 4️⃣ UPSERT EN TU DB
    // Usamos el ID del usuario como criterio de unicidad para evitar duplicados locales
    await Subscription.upsert({
      userId: user.id,
      stripe_checkout_session_id: session.id,
      stripe_customer_id: customerId,
      subscription_type: "RECURRING",
      price_id: priceId,
      status: "pending",
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Error en flujo de suscripción:", error.message);
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
    const { userId } = req.body;

    // 1. Buscamos la suscripción que está activa pero marcada para cancelarse (will_cancel_at != null)
    const subscription = await Subscription.findOne({
      where: {
        userId,
        status: "active", // Solo podemos reactivar si aún no ha llegado la fecha de corte definitiva
      },
    });

    // Validación: Si no hay suscripción o no tiene una fecha de cancelación programada
    if (!subscription || !subscription.will_cancel_at) {
      return res.status(400).json({
        message: "No tienes una cancelación programada para reactivar.",
      });
    }

    // 2. Quitamos la instrucción de cancelar en Stripe (cancel_at_period_end: false)
    // Esto reactiva el cobro automático para el siguiente ciclo.
    const stripeResponse = await stripe.subscriptions.update(
      subscription.stripe_subscription_id,
      { cancel_at_period_end: false },
    );

    // 3. Extraemos la fecha del próximo cobro desde Stripe
    // Stripe devuelve segundos (unix), Moment lo convierte a objeto Date de JS
    const nextRenewalDate = moment
      .unix(stripeResponse.current_period_end)
      .toDate();

    // 4. Actualizamos nuestra Base de Datos local
    await subscription.update({
      status: "active",
      will_cancel_at: null, // Limpiamos la fecha de cancelación
      next_renewal: nextRenewalDate, // Sincronizamos la fecha del próximo cobro
      ended_at: null, // Nos aseguramos de que no haya fecha de fin
    });

    // 5. Respuesta al cliente con formato amigable
    return res.status(200).json({
      message:
        "¡Membresía reactivada con éxito! Tu acceso continuará sin interrupciones.",
      next_billing_date: moment(nextRenewalDate).format("LL"), // Ejemplo: "18 de febrero de 2026"
    });
  } catch (error) {
    console.error("❌ Error al reactivar:", error.message);

    // Manejo de error específico: Si la suscripción ya pasó a estado 'canceled' en Stripe
    // mientras el usuario intentaba reactivarla.
    if (
      error.message.includes("not alterable") ||
      error.code === "resource_missing"
    ) {
      return res.status(400).json({
        message:
          "La suscripción ya ha expirado o no es válida para reactivación. Por favor, adquiere un nuevo plan.",
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
