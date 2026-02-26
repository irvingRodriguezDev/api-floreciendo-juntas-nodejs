const router = require("express").Router();

const controller = require("../controllers/NotificationController");
const { authMiddleware } = require("../middlewares/authMiddleware");

router.get("/", authMiddleware, controller.getNotifications);
router.get("/unread-count", authMiddleware, controller.getUnreadCount);
router.put("/:id/read", authMiddleware, controller.markAsRead);
router.patch("/read-all", authMiddleware, controller.markAllAsRead);

module.exports = router;
