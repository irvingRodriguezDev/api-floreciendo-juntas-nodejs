// routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/EventController");
const { handleUpload, upload } = require("../middlewares/uploadCourseImage");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Eventos
router.post("/", upload.single("image"), eventController.createEvent);
router.get("/", eventController.getEvents);
router.get("/topsales", eventController.topEventsSales);
router.get("/similar/:id", eventController.getSimilarEvents);
router.get("/latest", eventController.getLatestEvents);
router.get("/:eventId/calendar", eventController.downloadIcsFile);
router.get("/:slug", eventController.getEventById);
router.put(
  "/:id",
  handleUpload(upload.single("image")),
  eventController.updateEvent,
);
router.delete("/:id", eventController.deleteEvent);

// Comprar ticket
router.post("/buy/ticket", eventController.buyTicket);
router.post("/buy/ticket/open", eventController.buyTicketOpen);
router.post("/buy/ticket/remaining/:folio", eventController.payRemainingTicket);
router.post(
  "/reservation/uploadProff",
  handleUpload(upload.single("proof")),
  eventController.uploadTransferProof,
);
router.get(
  "/reservation/searchByFolio/:folio",
  eventController.getBookingByFolio,
);
router.get(
  "/reservation/ticketsByEvent/:eventId",
  eventController.getTicketsBookByEventId,
);

module.exports = router;
