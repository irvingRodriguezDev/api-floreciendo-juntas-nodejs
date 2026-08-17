const { Op } = require("sequelize");
const {
  Story,
  StoryView,
  User,
  NotificationToken,
  Notifications,
} = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const emitNotification = require("../helpers/emitNotification");
const {
  sendPushNotificationMulticast,
} = require("../services/sendPushNotification");

// 1. Crear una nueva historia
const createStory = async (req, res) => {
  try {
    const userId = req.user.id; // Asumiendo middleware de autenticación (req.user)
    const { caption } = req.body;

    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Debes adjuntar una imagen para tu historia." });
    }
    let urlmedia;
    try {
      urlmedia = await uploadToS3("stories", req.file, crypto.randomUUID());
    } catch (err) {
      console.error("Error subiendo historia a S3", err);
      return res.status(500).json({
        message: "Error al subir el archivo multimedia",
        error: err.message,
      });
    }

    const newStory = await Story.create({
      userId,
      mediaUrl: urlmedia,
      caption: caption || null,
      // expiresAt se calcula automáticamente por el defaultValue del modelo (+24 hrs)
    });

    res.status(201).json({
      message: "Historia publicada con éxito",
      story: newStory,
    });
    (async () => {
      try {
        const usersWithTokens = await User.findAll({
          where: { roleId: 4, isSubscribed: true, id: { [Op.ne]: userId } },
          attributes: ["id"],
          include: [
            {
              model: NotificationToken,
              as: "NotificationTokens",
              where: { isActive: true },
              attributes: ["token"],
              required: false,
            },
          ],
        });
        if (usersWithTokens.length > 0) {
          const notifTitle = "Nueva Historia 📸";
          const notifBody = `${req.user.name} Agrego contenido a su historia`;
          const notifUrl = `/comunidad`;

          // 1. Crear las notificaciones en la DB en lote
          const createdNotifications = await Notifications.bulkCreate(
            usersWithTokens.map((u) => ({
              userId: u.id,
              actorId: userId,
              type: "story",
              entityId: newStory.id,
              title: notifTitle,
              body: notifBody,
              url: notifUrl,
              data: { storyId: newStory.id },
            })),
            { returning: true }
          );

          // 2. Emitir por Socket en tiempo real a los usuarios conectados
          createdNotifications.forEach((notif) => {
            emitNotification(notif.userId, notif);
          });

          // 3. Recolectar tokens activos para Push (Firebase FCM)
          const allTokens = usersWithTokens.flatMap((u) =>
            (u.NotificationTokens || []).map((t) => t.token)
          );

          // 🔍 LOG DE DEPURACIÓN (Útil para validar en consola local)
          console.log(
            `🚀 Intentando enviar Push a ${allTokens.length} dispositivo(s)...`
          );

          if (allTokens.length > 0) {
            // Enviar en lotes de 500 (límite de FCM Multicast)
            for (let i = 0; i < allTokens.length; i += 500) {
              const batch = allTokens.slice(i, i + 500);
              await sendPushNotificationMulticast({
                tokens: batch,
                title: notifTitle,
                body: notifBody,
                data: {
                  type: "story",
                  storyId: String(newStory.id),
                  url: notifUrl,
                },
              }).catch((err) => {
                console.error("❌ Error enviando lote Push:", err);
              });
            }
          }
        }
      } catch (err) {
        console.error("Error al enviar notificaciones Historias", err);
      }
    })();
  } catch (error) {
    console.error("Error al crear historia:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

// 2. Obtener historias activas agrupadas por usuario para el carrusel
const getFeedStories = async (req, res) => {
  try {
    const currentUserId = req.user ? req.user.id : null;

    const activeStories = await Story.findAll({
      where: {
        expiresAt: {
          [Op.gt]: new Date(),
        },
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage", "createdAt"],
        },
        {
          model: StoryView,
          as: "views",
          attributes: ["viewerId"],
          required: false,
          include: [
            {
              model: User,
              as: "viewer",
              attributes: ["id", "name", "profileImage"],
            },
          ],
        },
      ],
      // Ordenamos globalmente por createdAt ASC para que dentro de cada usuario
      // las historias queden en orden cronológico correcto (1, 2, 3...)
      order: [["createdAt", "ASC"]],
    });

    const groupedStoriesMap = {};

    activeStories.forEach((story) => {
      const author = story.user;
      if (!author) return;

      if (!groupedStoriesMap[author.id]) {
        groupedStoriesMap[author.id] = {
          userId: author.id,
          userName: author.name,
          profileImage: author.profileImage
            ? getS3Url(author.profileImage)
            : null,
          hasUnseen: false,
          stories: [],
        };
      }
      // Validar si el usuario actual vio la historia
      const isSeenByCurrentUser = currentUserId
        ? story.views.some((view) => view.viewerId === currentUserId)
        : false;

      if (!isSeenByCurrentUser) {
        groupedStoriesMap[author.id].hasUnseen = true;
      }

      // Filtrar y mapear los viewers evitando nulos de forma segura
      const isAuthor = currentUserId === author.id;
      const mappedViewers = isAuthor
        ? story.views
            .filter((v) => v.viewer !== null && v.viewer !== undefined)
            .map((v) => ({
              id: v.viewer.id,
              name: v.viewer.name,
              profileImage: v.viewer.profileImage
                ? getS3Url(v.viewer.profileImage)
                : null,
            }))
        : [];

      groupedStoriesMap[author.id].stories.push({
        id: story.id,
        mediaUrl: getS3Url(story.mediaUrl),
        caption: story.caption,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        isSeen: isSeenByCurrentUser,
        viewsCount: story.views.length, // Contador ligero para el resto de usuarios
        viewers: mappedViewers, // Solo se puebla si el req.user es el dueño de la historia
      });
    });

    // Ordenar los grupos: primero los usuarios con historias NO VISTAS (hasUnseen: true)
    const feed = Object.values(groupedStoriesMap).sort((a, b) => {
      if (currentUserId) {
        if (a.userId === currentUserId) return -1;
        if (b.userId === currentUserId) return 1;
      }

      if (a.hasUnseen === b.hasUnseen) return 0;
      return a.hasUnseen ? -1 : 1;
    });

    return res.status(200).json(feed);
  } catch (error) {
    console.error("Error al obtener feed de historias:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

// 3. Marcar una historia como vista
const viewStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const viewerId = req.user.id;

    // Verificar si la historia existe y sigue activa
    const story = await Story.findOne({
      where: {
        id: storyId,
        expiresAt: { [Op.gt]: new Date() },
      },
    });

    if (!story) {
      return res
        .status(404)
        .json({ message: "La historia no existe o ya expiró." });
    }

    // Registrar la vista (findOrCreate evita duplicados si el usuario vuelve a verla)
    await StoryView.findOrCreate({
      where: {
        storyId,
        viewerId,
      },
      defaults: {
        storyId,
        viewerId,
      },
    });

    return res.status(200).json({ message: "Historia marcada como vista." });
  } catch (error) {
    console.error("Error al registrar vista:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

// 4. Eliminar historia (Por la usuaria creadora)
const deleteStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    const story = await Story.findOne({
      where: { id: storyId, userId },
    });

    if (!story) {
      return res
        .status(404)
        .json({ message: "Historia no encontrada o sin permisos." });
    }

    await story.destroy();

    return res
      .status(200)
      .json({ message: "Historia eliminada correctamente." });
  } catch (error) {
    console.error("Error al eliminar historia:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

module.exports = {
  deleteStory,
  createStory,
  getFeedStories,
  viewStory,
  deleteStory,
};
