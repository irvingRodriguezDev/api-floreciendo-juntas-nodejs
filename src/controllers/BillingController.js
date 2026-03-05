const stripe = require("../config/stripe");
const { User } = require("../models");
const createPortalSession = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user?.stripe_id) {
      return res.status(400).json({ error: "Usuario sin cliente Stripe" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_id,
      return_url: `${process.env.CLIENT_URL}/mi-perfil`, // cambia en producción
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Error creando portal:", error);
    res.status(500).json({ error: "No se pudo crear el portal" });
  }
};

module.exports = { createPortalSession };
