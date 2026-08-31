require("dotenv").config();
process.env.TZ = "America/Mexico_City";

const express = require("express");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { init } = require("./socket");
const sequelize = require("./config/db");
const seedData = require("./config/seed");
const routes = require("./routes");
const cors = require("cors");
const bodyParser = require("body-parser");
const webhookController = require("./controllers/WebhookController");
const socketAuth = require("./sockets/socketAuth");
const liveSocket = require("./sockets/live.socket");
const { initCronJobs } = require("./services/cronService");

const app = express();

// 🚀 REQUERIDO PARA AWS / LOAD BALANCER
app.set("trust proxy", 1);

// ==============================
// 🌍 CORS
// ==============================
const corsOptions = {
  origin: [
    "https://floreciendojuntas.com",
    "https://www.floreciendojuntas.com",
    "https://admin.floreciendojuntas.com",
    "https://www.admin.floreciendojuntas.com",
    "https://eventoswapizima.com",
    "https://localhost:3000",
    "https://localhost:3001",
    "http://localhost:3000",
    "http://localhost:5173",
    "https://excogitable-mavis-sulfureous.ngrok-free.dev",
    "https://cam-consolidated-blogging-meat.trycloudflare.com",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ==============================
// 1️⃣ Stripe Webhooks (Crudos para validación de firma)
// ==============================
app.post(
  "/webhooks/stripe/subscription",
  express.raw({ type: "application/json" }),
  webhookController.handleSubscriptionStripeWebhook,
);
app.post(
  "/webhooks/stripe/ticket",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleTicketStripeWebhook,
);
app.post(
  "/webhooks/stripe/order-payments",
  bodyParser.raw({ type: "application/json" }),
  webhookController.handleOrderPaymentStripeWebhook,
);
app.use(cors(corsOptions));
// app.options("*", cors(corsOptions));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
// ==============================
// 4️⃣ HTTP + Socket.IO
// ==============================
const httpServer = http.createServer(app);
const io = init(httpServer);

io.use(socketAuth);

io.on("connection", (socket) => {
  if (socket.user?.id) {
    socket.join(`user:${socket.user.id}`);
  }
  liveSocket(io, socket);
});

// ==============================
// 5️⃣ Rutas API
// ==============================
app.use("/api", routes);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      error: "Petición rechazada: El cuerpo enviado no es un JSON válido.",
    });
  }
  next(err);
  res.status(404).json({ msg: "Ruta no encontrada" });
});

// ==============================
// 6️⃣ Puerto & Start
// ==============================
const PORT = process.env.PORT || 3000;

sequelize
  .sync({ alter: false })
  .then(async () => {
    console.log("✅ Base de datos sincronizada");
    // await seedData();
    initCronJobs();
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Servidor corriendo en puerto ${PORT}`);
    });
  })
  .catch((err) => console.error("❌ Error DB:", err));
