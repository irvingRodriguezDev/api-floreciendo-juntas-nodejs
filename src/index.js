require("dotenv").config();
process.env.TZ = "America/Mexico_City";

const express = require("express");
const helmet = require("helmet");
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

// 🛡️ Configuración de Rate Limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // Subí un poco a 200 para evitar falsos positivos en apps con mucho tráfico
  message: { msg: "Demasiadas peticiones, intenta más tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

const app = express();

// 🚀 REQUERIDO PARA AWS / LOAD BALANCER
app.set("trust proxy", 1);

// ==============================
// 🛡️ Seguridad de Encabezados
// ==============================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://player.live-video.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://*.amazonaws.com",
          "wss://*.amazonaws.com",
          "https://*.ngrok-free.app",
        ],
        workerSrc: ["'self'", "blob:"],
      },
    },
  }),
);

// ==============================
// 🌍 CORS
// ==============================
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? [
            "https://floreciendojuntas.com",
            "https://admin.floreciendojuntas.com",
          ]
        : "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

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

// ==============================
// 2️⃣ Parsers & General Limit
// ==============================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api", generalLimiter); // 👈 Protege todos los endpoints de la API

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

app.use((req, res) => {
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
    await seedData();
    initCronJobs();
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Servidor corriendo en puerto ${PORT}`);
    });
  })
  .catch((err) => console.error("❌ Error DB:", err));
