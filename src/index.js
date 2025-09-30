require("dotenv").config();
const express = require("express");
const db = require("./models");
const seedData = require("./config/seed");
const routes = require("./routes");
const app = express();
app.use(express.json());

// Rutas
app.use("/api", routes);

const PORT = process.env.PORT || 3000;
db.sequelize
  .sync({ alter: true })
  .then(async () => {
    console.log("Base de datos sincronizada");
    await seedData(); // Insertar roles + admin
    app.listen(PORT, () =>
      console.log(`Servidor corriendo en http://localhost:${PORT}`)
    );
  })
  .catch((err) => console.error("Error DB:", err));
