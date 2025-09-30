const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { User, Subscription } = require("../models");

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const event = req.body;

    // try {
    //   event = stripe.webhooks.constructEvent(
    //     req.body,
    //     sig,
    //     process.env.STRIPE_WEBHOOK_SECRET
    //   );
    // } catch (err) {
    //   return res.status(400).send(`Webhook Error: ${err.message}`);
    // }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Recupera la sesión completa
      const stripeSession = await stripe.checkout.sessions.retrieve(session.id);

      const user = await User.findOne({
        where: { stripe_id: stripeSession.customer },
      });

      await Subscription.create({
        userId: user.id,
        stripe_subscription_id: stripeSession.subscription || null,
        subscription_type: stripeSession.mode,
        start_date: new Date(),
        end_date: stripeSession.mode === "payment" ? new Date() : null,
        next_renewal:
          stripeSession.mode === "subscription" ? calculateNextRenewal() : null,
        status: "active",
      });
    }

    res.status(200).json({ received: true });
  }
);

// Función para calcular la próxima renovación
function calculateNextRenewal() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1); // si tu plan es mensual
  return date;
}

module.exports = router;
