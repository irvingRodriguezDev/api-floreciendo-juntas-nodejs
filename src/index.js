require("dotenv").config();
process.env.TZ = "America/Mexico_City";

const express = require("express");
const http = require("http");
const { init } = require("./socket");
const sequelize = require("./config/db");
const seedData = require("./config/seed");
const routes = require("./routes");
const cors = require("cors");
const bodyParser = require("body-parser");
const webhookController = require("./controllers/WebhookController");
const expireSubscriptionsJob = require("./jobs/expireSubscriptions");
const releaseExpiredReservations = require("./jobs/releaseReservations");
const socketAuth = require("./sockets/socketAuth");
const liveSocket = require("./sockets/live.socket");

const app = express();

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ==============================
// 1️⃣ Stripe Webhooks
// ==============================
app.post(
  "/webhooks/stripe/subscription",
  express.raw({ type: "application/json" }),
  webhookController.handleSubscriptionStripeWebhook
);

app.post(
  "/webhooks/stripe/ticket",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleTicketStripeWebhook
);

app.post(
  "/webhooks/stripe/order-payments",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleOrderPaymentStripeWebhook
);

// ==============================
// 2️⃣ Parsers
// ==============================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ==============================
// 3️⃣ CORS
// ==============================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ==============================
// 4️⃣ HTTP + Socket.IO
// ==============================
const httpServer = http.createServer(app);
const io = init(httpServer);

// 🔐 Auth middleware
io.use(socketAuth);
// 👇 registrar sockets por dominio
io.on("connection", (socket) => {
  liveSocket(io, socket);
});

// ==============================
// 5️⃣ Rutas API
// ==============================
app.use("/api", routes);

// 404
app.use((req, res) => {
  res.status(404).json({ msg: "Ruta no encontrada" });
});

// ==============================
// 6️⃣ Puerto
// ==============================
const PORT = process.env.PORT || 3000;

// ==============================
// 7️⃣ DB + seed + cron + server
// ==============================
sequelize
  .sync({ alter: false })
  .then(async () => {
    console.log("✅ Base de datos sincronizada");

    await seedData();
    console.log("✅ Seed completado");

    expireSubscriptionsJob.start();
    releaseExpiredReservations.start();
    console.log("🕒 Cron jobs iniciados");

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`🌐 Exponer con ngrok: ngrok http ${PORT}`);
    });
  })
  .catch((err) => console.error("❌ Error DB:", err));
