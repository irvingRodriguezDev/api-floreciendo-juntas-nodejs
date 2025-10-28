// routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/EventController");
const { upload } = require("../middlewares/uploadCourseImage");
const authMiddleware = require("../middlewares/authMiddleware");

// Eventos
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  eventController.createEvent
);
router.get("/", eventController.getEvents);
router.get("/latest", eventController.getLatestEvents);
router.get("/:id", eventController.getEventById);

// Comprar ticket
router.post("/:id/buy", eventController.buyTicket);

module.exports = router;
