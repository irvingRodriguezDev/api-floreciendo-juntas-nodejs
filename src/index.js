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

const app = express();

// ==============================
// 1️⃣ Stripe Webhook (raw body)
// ==============================
app.post(
  "/webhook/stripe",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleStripeWebhook
);

// ==============================
// 2️⃣ Parsers normales
// ==============================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ==============================
// 3️⃣ CORS configurado para frontend
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
// 4️⃣ Crear servidor HTTP + Socket.IO
// ==============================
const httpServer = http.createServer(app);
const io = init(httpServer);
io.on("connection", (socket) => {
  console.log("🔗 Cliente conectado:", socket.id);
  socket.on("disconnect", () =>
    console.log("❌ Cliente desconectado:", socket.id)
  );
});

// ==============================
// 5️⃣ Rutas API
// ==============================
app.use("/api", routes);

// Middleware 404
app.use((req, res) => {
  res.status(404).json({ msg: "Ruta no encontrada" });
});

// ==============================
// 6️⃣ Puerto del servidor
// ==============================
const PORT = process.env.PORT || 3000;

// ==============================
// 7️⃣ Iniciar DB, seed y cron
// ==============================
sequelize
  .sync({ alter: false })
  .then(async () => {
    console.log("✅ Base de datos sincronizada");

    await seedData();
    console.log("✅ Seed completado");

    // Iniciar cron jobs
    expireSubscriptionsJob.start();
    console.log("🕒 Cron jobs iniciados");

    // Levantar servidor HTTP
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`🌐 Exponer con ngrok: ngrok http ${PORT}`);
    });
  })
  .catch((err) => console.error("❌ Error DB:", err));
