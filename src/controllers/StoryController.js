const { Op } = require("sequelize");
const { Story, StoryView, User } = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");

// 1. Crear una nueva historia
const createStory = async (req, res) => {
  try {
    const userId = req.user.id; // Asumiendo middleware de autenticación (req.user)
    const { caption } = req.body;

    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Debes adjuntar una imagen o video." });
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

    return res.status(201).json({
      message: "Historia publicada con éxito",
      story: newStory,
    });
  } catch (error) {
    console.error("Error al crear historia:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

// 2. Obtener historias activas agrupadas por usuario para el carrusel
const getFeedStories = async (req, res) => {
  try {
    const currentUserId = req.user ? req.user.id : null;

    // Obtener historias donde expiresAt > NOW()
    const activeStories = await Story.findAll({
      where: {
        expiresAt: {
          [Op.gt]: new Date(), // Solo las de las últimas 24 horas
        },
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage"], // Ajusta según tus campos de User
        },
        {
          model: StoryView,
          as: "views",
          attributes: ["viewerId"],
          required: false,
        },
      ],
      order: [["createdAt", "ASC"]],
    });
    // Agrupar historias por usuario para facilitar el renderizado en el Frontend
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

      // Verificar si el usuario actual ya vio esta historia específica
      const isSeenByCurrentUser = currentUserId
        ? story.views.some((view) => view.viewerId === currentUserId)
        : false;

      if (!isSeenByCurrentUser) {
        groupedStoriesMap[author.id].hasUnseen = true;
      }

      groupedStoriesMap[author.id].stories.push({
        id: story.id,
        mediaUrl: getS3Url(story.mediaUrl),
        caption: story.caption,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        isSeen: isSeenByCurrentUser,
      });
    });

    // Convertir el objeto agrupado a un Array
    const feed = Object.values(groupedStoriesMap);

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
