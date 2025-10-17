process.env.TZ = "America/Mexico_City";
require("dotenv").config();
const express = require("express");
const db = require("./models");
const seedData = require("./config/seed");
const routes = require("./routes");
const cors = require("cors");
const webhookController = require("./controllers/WebhookController");
const bodyParser = require("body-parser");
const expireSubscriptionsJob = require("./jobs/expireSubscriptions");
const app = express();

// 🧠 PRIMERO el Webhook (usa raw body)
app.post(
  "/webhook/stripe",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleStripeWebhook
);

// 👇 AHORA sí, los parsers normales
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: false,
  })
);

// Rutas API
app.use("/api", routes);

// Middleware 404
app.use((req, res) => {
  res.status(404).json({ msg: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3000;

db.sequelize
  .sync({ alter: false })
  .then(async () => {
    console.log("Base de datos sincronizada");
    await seedData();
    // ✅ Iniciar cron job
    expireSubscriptionsJob.start();
    app.listen(PORT, () =>
      console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`)
    );
  })
  .catch((err) => console.error("Error DB:", err));
