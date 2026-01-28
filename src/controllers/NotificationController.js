const { Notifications } = require("../models");
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0, unread } = req.query;

    const where = { userId };

    if (unread === "true") {
      where.readAt = null;
    }

    const notifications = await Notifications.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: Number(offset),
    });

    res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error("❌ getNotifications:", error);
    res.status(500).json({ message: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notifications.findOne({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({ message: "No encontrada" });
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ markAsRead:", error);
    res.status(500).json({ message: error.message });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await Notifications.update(
      { readAt: new Date() },
      {
        where: {
          userId,
          readAt: null,
        },
      },
    );

    res.json({ success: true });
  } catch (error) {
    console.error("❌ markAllAsRead:", error);
    res.status(500).json({ message: error.message });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const count = await Notifications.count({
      where: {
        userId,
        readAt: null,
      },
    });

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("❌ getUnreadCount:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
};
