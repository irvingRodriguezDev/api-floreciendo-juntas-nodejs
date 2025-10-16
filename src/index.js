require("dotenv").config();
const express = require("express");
const db = require("./models");
const seedData = require("./config/seed");
const routes = require("./routes");
const cors = require("cors");
const { handleStripeWebhook } = require("./controllers/WebhookController");
const app = express();

// Middlewares
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }), // Usa express.raw() para obtener el body sin parsear
  handleStripeWebhook // Tu función handler
);
// CORS
app.use(
  cors({
    origin: "*", // en producción reemplazar con tu dominio
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: false, // cambiar a true solo con un origen específico
  })
);

// Rutas
app.use("/api", routes);

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ msg: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3000;

db.sequelize
  .sync({ alter: false }) // ok para desarrollo
  .then(async () => {
    console.log("Base de datos sincronizada");
    await seedData();
    app.listen(PORT, () =>
      console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`)
    );
  })
  .catch((err) => console.error("Error DB:", err));
