// routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/EventController");
const { upload } = require("../middlewares/uploadCourseImage");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Eventos
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  eventController.createEvent,
);
router.get("/", eventController.getEvents);
router.get("/topsales", eventController.topEventsSales);
router.get("/similar/:id", eventController.getSimilarEvents);
router.get("/latest", eventController.getLatestEvents);
router.get("/:eventId/calendar", eventController.downloadIcsFile);
router.get("/:id", eventController.getEventById);
router.put("/:id", upload.single("image"), eventController.updateEvent);
router.delete("/:id", authMiddleware, eventController.deleteEvent);

// Comprar ticket
router.post("/buy/ticket", eventController.buyTicket);

module.exports = router;
