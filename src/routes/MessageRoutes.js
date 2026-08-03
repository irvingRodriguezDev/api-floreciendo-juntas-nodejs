const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const {
  sendBirthdayWish,
  getConversations,
  getMessagesByConversation,
  markAsRead,
  getUnreadCount,
} = require("../controllers/messageController");
router.post("/wish-birthday", authMiddleware, sendBirthdayWish);
router.get("/conversations", authMiddleware, getConversations);
router.get(
  "/conversations/:conversationId",
  authMiddleware,
  getMessagesByConversation,
);
router.put("/read/:conversationId", authMiddleware, markAsRead);
router.get("/unread-count", authMiddleware, getUnreadCount);

module.exports = router;
