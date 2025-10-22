process.env.TZ = "America/Mexico_City";
require("dotenv").config();

const express = require("express");
const http = require("http"); // 👈 Necesario para crear el servidor
const { Server: SocketServer } = require("socket.io");
const sequelize = require("./config/db");
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

// ✅ Crear servidor HTTP a partir de Express
const server = http.createServer(app);

// ✅ Crear instancia de Socket.IO
const io = new SocketServer(server, {
  cors: {
    origin: "*", // Cambia esto por tu dominio o http://localhost:3000
  },
});

// ✅ Configurar los eventos de conexión de Socket.IO
io.on("connection", (socket) => {
  console.log("🔗 Cliente conectado:", socket.id);

  socket.on("newPost", (post) => {
    console.log("📝 Nuevo post recibido:", post);
    io.emit("postCreated", post); // Envía a todos los clientes
  });

  socket.on("newComment", (comment) => {
    console.log("💬 Nuevo comentario:", comment);
    io.emit("commentCreated", comment);
  });

  socket.on("newReaction", (reaction) => {
    console.log("❤️ Nueva reacción:", reaction);
    io.emit("reactionUpdated", reaction);
  });

  socket.on("disconnect", () => {
    console.log("❌ Cliente desconectado:", socket.id);
  });
});

// ✅ Rutas API
app.use("/api", routes);

// Middleware 404
app.use((req, res) => {
  res.status(404).json({ msg: "Ruta no encontrada" });
});

// ✅ Puerto del servidor
const PORT = process.env.PORT || 3000;

// ✅ Iniciar base de datos, seed y cron
sequelize
  .sync({ alter: false })
  .then(async () => {
    console.log("Base de datos sincronizada");

    await seedData();

    // Iniciar cron
    expireSubscriptionsJob.start();

    // ❗ IMPORTANTE: Iniciar el servidor HTTP (NO app.listen)
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Servidor corriendo en http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => console.error("Error DB:", err));
