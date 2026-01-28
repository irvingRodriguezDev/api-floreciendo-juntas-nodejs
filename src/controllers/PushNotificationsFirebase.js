const NotificationToken = require("../models/NotificationToken");

const saveNotificationToken = async (req, res) => {
  try {
    const { token, device, browserId } = req.body;
    const userId = req.user.id;

    if (!token || !browserId) {
      return res.status(400).json({ message: "Token o browserId faltante" });
    }

    /**
     * 1️⃣ Desactivar tokens previos
     *    del mismo usuario + navegador
     */
    await NotificationToken.update(
      { isActive: false },
      {
        where: {
          userId,
          browserId,
        },
      },
    );

    /**
     * 2️⃣ Upsert del token actual
     */
    await NotificationToken.upsert({
      token,
      userId,
      device: device || "web",
      browserId,
      isActive: true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ saveNotificationToken:", error);
    res.status(500).json({ message: "Error guardando token" });
  }
};

module.exports = saveNotificationToken;
