const { Op } = require("sequelize");
const { Story, StoryView, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const { sendNotificationToUsers } = require("../services/notificationService");
const { addPoints } = require("../utils/addPoints");
const sequelize = require("../config/db");
const convertImageIfNeeded = require("../helpers/convertImages");
const ALLOWED_MIME_TYPES = [
  // Imágenes
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",

  // Videos
  "video/mp4",
  "video/quicktime", // .mov (iPhone)
];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 50 MB
// 1. Crear una nueva historia
const createStory = async (req, res) => {
  let urlmedia = null;
  let isVideo = false;

  try {
    const userId = req.user.id;
    const { caption, mediaType } = req.body;
    console.log(caption, "el caption");

    const file = req.file;

    if (!file) {
      return res
        .status(400)
        .json({ message: "Debes adjuntar un archivo para tu historia." });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return res.status(400).json({
        message: `Formato no soportado: ${file.originalname || file.mimetype}`,
      });
    }

    // Validación de Tamaño según el tipo de archivo
    isVideo = file.mimetype.startsWith("video");
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

    if (file.size > maxSize) {
      return res.status(400).json({
        message: `El archivo supera el límite permitido (${isVideo ? "100MB" : "10MB"}).`,
      });
    }

    // 1. Subida a S3
    try {
      const mediaFile = isVideo ? file : await convertImageIfNeeded(file);
      const uniqueId = crypto.randomUUID();

      urlmedia = await uploadToS3("stories", mediaFile, uniqueId);
    } catch (err) {
      console.error("Error subiendo historia a S3:", err);
      return res.status(500).json({
        message: "Error al subir el archivo multimedia a la nube.",
        error: err.message,
      });
    }

    // 2. Transacción SQL
    const t = await sequelize.transaction();
    let newStory;

    try {
      newStory = await Story.create(
        {
          userId,
          mediaUrl: urlmedia,
          caption: caption || null,
          type: isVideo ? "video" : "image",
        },
        { transaction: t },
      );

      await addPoints(
        userId,
        70,
        "custom",
        newStory.id,
        `El usuario con Id: ${userId} ha subido contenido a su historia`,
        t,
      );

      await t.commit();
    } catch (dbError) {
      await t.rollback();
      // Opcional: si la BD falla, eliminar el archivo subido previamente
      // await deleteFromS3(urlmedia);
      throw dbError;
    }

    // 3. Respuesta al cliente
    res.status(201).json({
      message: "Historia publicada con éxito",
      story: newStory,
    });

    // 4. Notificaciones en segundo plano
    (async () => {
      try {
        const subscribers = await User.findAll({
          where: {
            roleId: 4,
            isSubscribed: true,
            id: { [Op.ne]: userId },
          },
          attributes: ["id"],
          raw: true,
        });

        const recipientIds = subscribers.map((u) => u.id);

        if (recipientIds.length > 0) {
          await sendNotificationToUsers({
            recipientIds,
            actorId: userId,
            type: "story",
            entityId: newStory.id,
            title: "Nueva Historia 📸",
            body: `${req.user.name} agregó contenido a su historia`,
            url: "/comunidad",
            extraData: { storyId: newStory.id },
          });
        }
      } catch (err) {
        console.error("Error al enviar notificaciones de Historias:", err);
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
        type: story.type,
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
