// src/config/stripe.js
require("dotenv").config(); // ⬅️ Asegura que cargue .env

const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("⚠️ STRIPE_SECRET_KEY no definida en el .env");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

module.exports = stripe;
