// controllers/post.controller.js
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  Post,
  PostComment,
  PostMedia,
  PostLike,
  User,
  PostCommentLike,
} = require("../models");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const { getIO } = require("../socket");
const convertImageIfNeeded = require("../helpers/convertImages");
const deleteFromS3 = require("../helpers/deleteFromS3");
const { Op } = require("sequelize");
const { addPoints } = require("../utils/addPoints");
const moment = require("moment-timezone");
const { sendNotificationToUsers } = require("../services/notificationService");
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
const withDeadlockRetry = async (fn, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isDeadlock = error?.parent?.code === "ER_LOCK_DEADLOCK";
      if (isDeadlock && attempt < retries) {
        // Espera exponencial: 100ms, 200ms, 400ms...
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      throw error; // Si no es deadlock o se agotaron los reintentos, relanzar
    }
  }
};
const createPost = async (req, res) => {
  const userId = req.user.id;

  const { title, content = "", pinned = false, durationHours, type } = req.body;
  const isPinned = pinned === "true" || pinned === true;

  // 💡 Si no envían durationHours o es inválido, evitamos un Date inválido
  const hours = parseInt(durationHours, 10);
  const expiryDate = !isNaN(hours)
    ? moment().add(hours, "hours").toDate()
    : null;

  const files = req.files || [];
  const uploadedFiles = []; // Para rollback de S3 si algo falla

  try {
    /* 1. VALIDACIONES INICIALES */
    if (!title?.trim())
      return res.status(400).json({ message: "El título es obligatorio" });
    if (!content.trim())
      return res.status(400).json({ message: "El contenido es obligatorio" });

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res
          .status(400)
          .json({ message: `Formato no soportado: ${file.originalname}` });
      }
    }

    /* 2. PROCESAMIENTO DE MEDIA (S3) ANTES DE DB */
    const mediaToCreate = [];
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isVideo = file.mimetype.startsWith("video");
        const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

        const uniqueId = crypto.randomUUID();
        const finalPath = await uploadToS3("post-media", mediaFile, uniqueId);
        uploadedFiles.push(finalPath);

        mediaToCreate.push({
          modelType: "post",
          type: isVideo ? "video" : "image",
          order: i,
          url: finalPath,
        });
      }
    }

    /* 3. TRANSACCIÓN DE DB */
    const result = await withDeadlockRetry(() =>
      sequelize.transaction(async (t) => {
        const post = await Post.create(
          {
            userId,
            title: title.trim(),
            content: content.trim(),
            isPinned: isPinned,
            pinnedUntil: isPinned ? expiryDate : null,
            type: type,
          },
          { transaction: t },
        );

        await addPoints(
          userId,
          80,
          "custom",
          post.id,
          `El usuario con id: ${userId} ha creado un nuevo post en la comunidad con id: ${post.id}`,
          t,
        );

        let createdMedia = [];
        if (mediaToCreate.length > 0) {
          const recordsWithId = mediaToCreate.map((m) => ({
            ...m,
            modelId: post.id,
          }));
          createdMedia = await PostMedia.bulkCreate(recordsWithId, {
            transaction: t,
            returning: true,
          });
        }

        return { post, createdMedia };
      }),
    );

    const { post, createdMedia } = result;

    /* 4. CONSTRUCCIÓN DE RESPUESTA Y ESTRUCTURA DE SOCKET */
    const responsePost = {
      ...post.toJSON(),
      id: Number(post.id), // Normalizado como número
      userId: Number(userId),
      commentsCount: 0,
      likesCount: 0,
      isLikedByMe: false,
      comments: [],
      user: {
        id: Number(userId),
        name: req.user.name,
        profileImage: req.user.profileImage
          ? getS3Url(req.user.profileImage)
          : null,
      },
      media: createdMedia.map((m) => {
        const item = typeof m.toJSON === "function" ? m.toJSON() : m;
        return {
          ...item,
          url: getS3Url(item.url),
        };
      }),
    };

    // 💡 Emisión Global para asegurar que todos los sockets activos lo reciban en el feed
    getIO().emit("postCommunityCreated", responsePost);

    // 5. RESPUESTA AL CLIENTE
    res.json({
      success: true,
      post: responsePost,
      message: "Post publicado exitosamente",
    });

    /* 6. BACKGROUND (Notificaciones Push) */
    (async () => {
      try {
        const subscribers = await User.findAll({
          where: {
            roleId: 4,
            isSubscribed: true,
            id: { [sequelize.Op?.ne || Op.ne]: userId },
          },
          attributes: ["id"],
          raw: true,
        });

        const recipientIds = subscribers.map((u) => u.id);

        if (recipientIds.length > 0) {
          await sendNotificationToUsers({
            recipientIds,
            actorId: userId,
            type: "post",
            entityId: post.id,
            title: "Nuevo post 🌸",
            body: `${req.user.name} publicó un nuevo post`,
            url: `/comunidad/${post.id}`,
            extraData: { postId: String(post.id) },
          });
        }
      } catch (err) {
        console.error("❌ Error en Notificaciones Post:", err);
      }
    })();
  } catch (error) {
    for (const path of uploadedFiles) {
      await deleteFromS3(path).catch(() => {});
    }

    console.error("❌ Error Fatal CreatePost:", error);
    if (!res.headersSent) res.status(500).json({ message: error.message });
  }
};
const getFeed = async (req, res) => {
  try {
    const { search, type } = req.query;
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const hasSearch = Boolean(search && search.trim());
    const baseCondition = type ? { type } : {};

    // 1. Condición de búsqueda corregida
    const whereCondition = hasSearch
      ? {
          ...baseCondition,
          [Op.or]: [
            { content: { [Op.like]: `%${search}%` } },
            { title: { [Op.like]: `%${search}%` } },
          ],
        }
      : baseCondition;

    // 2. Inclusion común ajustada con la nueva jerarquía de Comentarios + Respuestas
    const commonInclude = [
      {
        model: User,
        as: "user",
        attributes: ["id", "name", "profileImage", "isVerified"],
      },
      {
        model: PostMedia,
        as: "media",
        separate: true,
        order: [["order", "ASC"]],
      },
      {
        model: PostLike,
        as: "likes",
        attributes: ["userId"],
      },
      {
        model: PostComment,
        as: "comments",
        where: { parentId: null }, // 🔥 Solo traer comentarios RAÍZ al Feed
        required: false,
        attributes: [
          "id",
          "content",
          "createdAt",
          "userId",
          "parentId",
          "replyToUserId",
        ],
        limit: 3, // 🔥 En el feed solo mostramos los primeros 2-3 comentarios principales
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "profileImage", "isVerified"],
          },
          {
            model: PostMedia,
            as: "media",
          },
          {
            model: PostCommentLike,
            as: "post_comments_likes",
            attributes: ["id", "userId"],
          },
          {
            model: PostComment,
            as: "replies",
            include: [
              {
                model: User,
                as: "user",
                attributes: ["id", "name", "profileImage"],
              },
              {
                model: User,
                as: "replyToUser",
                attributes: ["id", "name"],
              },
              {
                model: PostMedia,
                as: "media",
              },
              {
                model: PostCommentLike,
                as: "post_comments_likes",
                attributes: ["id", "userId"],
              },
            ],
          },
        ],
      },
    ];

    // 3. Helper de formateo recursivo para armar URLs de S3 y conteos
    const formatComment = (comment) => {
      if (!comment) return null;
      return {
        ...comment,
        user: comment.user
          ? {
              ...comment.user,
              profileImage: comment.user.profileImage
                ? getS3Url(comment.user.profileImage)
                : null,
            }
          : null,
        media: (comment.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),
        post_comments_likes: comment.post_comments_likes || [],
        likesCount: comment.post_comments_likes?.length || 0,
        isLikedByMe: (comment.post_comments_likes || []).some(
          (l) => l.userId === userId,
        ),
        replies: (comment.replies || []).map(formatComment),
      };
    };

    const formatPost = (post) => {
      const postJson = post.toJSON();
      const likedByMe = (postJson.likes || []).some(
        (like) => like.userId === userId,
      );

      return {
        ...postJson,
        likedByMe,
        user: postJson.user
          ? {
              ...postJson.user,
              profileImage: postJson.user.profileImage
                ? getS3Url(postJson.user.profileImage)
                : null,
            }
          : null,
        media: (postJson.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),
        comments: (postJson.comments || []).map(formatComment),
        likesCount: postJson.likes?.length || 0,
        // 🔥 commentsCount real o de la muestra
        commentsCount: postJson.comments?.length || 0,
      };
    };

    let posts = [];
    let total = 0;

    if (hasSearch) {
      const { rows, count } = await Post.findAndCountAll({
        where: whereCondition,
        order: [
          ["isPinned", "DESC"],
          ["pinnedUntil", "DESC"],
          ["createdAt", "DESC"],
        ],
        distinct: true,
        include: commonInclude,
      });
      posts = rows.map(formatPost);
      total = count;
    } else {
      // Página 1: incluir fijados al inicio
      const pinnedRows =
        page === 1
          ? await Post.findAll({
              where: { ...baseCondition, isPinned: true },
              order: [
                ["pinnedUntil", "DESC"],
                ["createdAt", "DESC"],
              ],
              distinct: true,
              include: commonInclude,
            })
          : [];

      const normalWhere = { ...baseCondition, isPinned: false };

      const { rows: normalRows, count } = await Post.findAndCountAll({
        where: normalWhere,
        order: [["createdAt", "DESC"]],
        limit,
        offset,
        distinct: true,
        include: commonInclude,
      });

      posts = [...pinnedRows.map(formatPost), ...normalRows.map(formatPost)];
      total = count;
    }

    return res.json({
      success: true,
      data: posts,
      ...(hasSearch
        ? {}
        : {
            pagination: {
              total,
              page,
              limit,
              totalPages: Math.ceil(total / limit),
            },
          }),
    });
  } catch (error) {
    console.error("❌ getFeed error:", error);
    return res.status(500).json({ message: error.message });
  }
};

const toggleLike = async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.user.id;
  const userName = req.user.name;

  try {
    // 1. Buscamos el post rápido
    const post = await Post.findByPk(postId, { attributes: ["id", "userId"] });
    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    // 2. Intentamos borrar el like primero
    const deletedCount = await PostLike.destroy({
      where: { postId, userId },
    });

    let liked = false;

    if (deletedCount === 0) {
      // Si no borró nada, creamos el Like
      await PostLike.create({ postId, userId });

      // Puntos al usuario
      addPoints(
        userId,
        40,
        "custom",
        postId,
        `El usuario con Id: ${userId} reacciono al post: ${postId}`,
      ).catch(() => {});
      liked = true;
    }

    // 3. Obtener el conteo actualizado de likes del post
    const likesCount = await PostLike.count({ where: { postId } });

    // 4. WebSocket en tiempo real
    getIO().emit("postLikeToggled", {
      postId: Number(postId),
      userId,
      liked,
      likesCount,
    });

    // 5. Respuesta HTTP inmediata
    res.json({ success: true, liked, likesCount });

    // 6. Notificación Push en segundo plano
    if (liked && post.userId !== userId) {
      (async () => {
        try {
          await sendNotificationToUsers({
            recipientIds: [post.userId], // Asegurar formato de Array
            actorId: userId,
            type: "like",
            entityId: postId,
            title: "Nueva reacción ❤️",
            body: `${userName} reaccionó a tu publicación`,
            url: `/comunidad/${postId}`,
            extraData: { postId: String(postId) },
          });
        } catch (err) {
          console.error("❌ Error notificación like:", err);
        }
      })();
    }
  } catch (error) {
    console.error("❌ toggleLike error:", error);
    if (!res.headersSent) res.status(500).json({ message: error.message });
  }
};

const addComment = async (req, res) => {
  const userId = req.user.id;
  const postId = Number(req.params.id); // 💡 Normalizado a Number
  const uploadedFiles = [];
  const files = req.files || [];

  try {
    /* 1. VALIDACIONES Y PREPARACIÓN */
    const { content, parentId, replyToUserId } = req.body;

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res
          .status(400)
          .json({ message: `Formato no soportado: ${file.originalname}` });
      }
    }

    // Buscamos usuario actual, post y (si aplica) usuario al que se le responde
    const [user, post, replyToUser] = await Promise.all([
      User.findByPk(userId, { attributes: ["id", "name", "profileImage"] }),
      Post.findByPk(postId, {
        attributes: ["id", "userId", "title"],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name"],
          },
        ],
      }),
      replyToUserId
        ? User.findByPk(replyToUserId, { attributes: ["id", "name"] })
        : null,
    ]);

    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    /* 2. TRABAJO PESADO (S3) */
    const mediaToCreate = await Promise.all(
      files.map(async (file, i) => {
        const isVideo = file.mimetype.startsWith("video");
        const mediaFile = isVideo ? file : await convertImageIfNeeded(file);
        const uniqueId = crypto.randomUUID();
        const finalPath = await uploadToS3(
          "comment-media",
          mediaFile,
          uniqueId,
        );
        uploadedFiles.push(finalPath);

        return {
          modelType: "comment",
          type: isVideo ? "video" : "image",
          order: i,
          url: finalPath,
        };
      }),
    );

    /* 3. TRANSACCIÓN EXPRESS */
    const fullComment = await sequelize.transaction(async (t) => {
      const comment = await PostComment.create(
        {
          postId,
          userId,
          content,
          parentId: parentId ? Number(parentId) : null,
          replyToUserId: replyToUserId ? Number(replyToUserId) : null,
        },
        { transaction: t },
      );

      await addPoints(
        userId,
        50,
        "custom",
        comment.id,
        `El usuario con Id: ${userId} ha realizado un comentario con id: ${comment.id} al post con id: ${postId} `,
        t,
      );

      let createdMedia = [];
      if (mediaToCreate.length > 0) {
        const mediaWithId = mediaToCreate.map((m) => ({
          ...m,
          modelId: comment.id,
        }));
        createdMedia = await PostMedia.bulkCreate(mediaWithId, {
          transaction: t,
          returning: true,
        });
      }

      return {
        ...comment.get({ clone: true }),
        user,
        replyToUser,
        media: createdMedia,
        likes: [],
        likesCount: 0,
        isLikedByMe: false,
        replies: [],
      };
    });

    /* 4. FORMATEO Y RESPUESTA INMEDIATA */
    const response = {
      ...fullComment,
      user: {
        id: user.id,
        name: user.name,
        profileImage: user.profileImage ? getS3Url(user.profileImage) : null,
      },
      replyToUser: replyToUser
        ? { id: replyToUser.id, name: replyToUser.name }
        : null,
      media: (fullComment.media || []).map((m) => {
        const item = typeof m.get === "function" ? m.get() : m;
        return {
          ...item,
          url: getS3Url(item.url),
        };
      }),
    };

    // Emitimos por WebSocket
    getIO().emit("createCommentPostCommunity", {
      postId,
      comment: response,
      userId,
      parentId: parentId ? Number(parentId) : null,
      isReply: Boolean(parentId),
    });

    res.json({ success: true, data: response });

    /* 5. BACKGROUND (Notificaciones Directas y de Hilo) */
    (async () => {
      try {
        const notifUrl = `/comunidad/${postId}`;
        const extraData = {
          postId: String(postId),
          commentId: String(fullComment.id),
        };

        // CASO 1: Es una RESPUESTA DIRECTA a un comentario
        if (parentId && replyToUserId && Number(replyToUserId) !== userId) {
          await sendNotificationToUsers({
            recipientIds: [Number(replyToUserId)],
            actorId: userId,
            type: "comment_reply",
            entityId: fullComment.id,
            title: "Respondieron a tu comentario 💬",
            body: `${user.name} te respondió: "${(content || "").substring(0, 40)}..."`,
            url: notifUrl,
            extraData,
          });
          return;
        }

        // CASO 2: Es un COMENTARIO RAÍZ -> Notificar al dueño del Post
        if (!parentId && post.userId !== userId) {
          await sendNotificationToUsers({
            recipientIds: [post.userId],
            actorId: userId,
            type: "comment",
            entityId: fullComment.id,
            title: "Nuevo comentario 💬",
            body: `${user.name} comentó tu publicación`,
            url: notifUrl,
            extraData,
          });
        }

        // CASO 3: Notificar a otros participantes del Post
        const excludedUserIds = [userId, post.userId];
        if (replyToUserId) excludedUserIds.push(Number(replyToUserId));

        const previousCommenters = await PostComment.findAll({
          where: {
            postId: postId,
            userId: {
              [sequelize.Op?.notIn || Op.notIn]: excludedUserIds,
            },
          },
          attributes: [
            [sequelize.fn("DISTINCT", sequelize.col("userId")), "userId"],
          ],
          raw: true,
        });

        const participantIds = previousCommenters.map((c) => c.userId);

        if (participantIds.length > 0) {
          const postOwnerName = post.user?.name || "una publicación";

          await sendNotificationToUsers({
            recipientIds: participantIds,
            actorId: userId,
            type: "comment",
            entityId: fullComment.id,
            title: "Nuevo comentario en una conversación 💬",
            body: `${user.name} también comentó la publicación de ${postOwnerName}`,
            url: notifUrl,
            extraData,
          });
        }
      } catch (err) {
        console.error("⚠️ Error background addComment:", err);
      }
    })();
  } catch (error) {
    for (const path of uploadedFiles) {
      try {
        await deleteFromS3(path);
      } catch {}
    }
    console.error("❌ addComment error:", error);
    if (!res.headersSent) res.status(500).json({ message: error.message });
  }
};

const toggleCommentLike = async (req, res) => {
  const userId = req.user.id;
  const { commentId } = req.params;

  try {
    // 1. Verificar existencia del comentario
    const comment = await PostComment.findByPk(commentId, {
      attributes: ["id", "postId", "userId", "content", "parentId"],
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!comment) {
      return res.status(404).json({ message: "El comentario no existe." });
    }

    const existingLike = await PostCommentLike.findOne({
      where: { commentId, userId },
    });

    let liked = false;

    if (existingLike) {
      // UNLIKE: Transacción para borrar el Like y RESTAR los puntos acumulados
      await sequelize.transaction(async (t) => {
        await existingLike.destroy({ transaction: t });
        liked = false;

        await addPoints(
          userId,
          -40,
          "custom",
          existingLike.id,
          `El usuario: ${userId} ha quitado su reaccion al comentario`,
          t,
        );
      });
    } else {
      // LIKE: Transacción para crear Like y SUMAR puntos
      await sequelize.transaction(async (t) => {
        const likeComment = await PostCommentLike.create(
          { commentId, userId },
          { transaction: t },
        );
        liked = true;

        await addPoints(
          userId,
          40,
          "custom",
          likeComment.id,
          `El usuario: ${userId} ha dado like al comentario`,
          t,
        );
      });
    }

    // 3. Obtener el conteo actualizado de likes
    const likesCount = await PostCommentLike.count({ where: { commentId } });

    const payload = {
      commentId: Number(commentId),
      postId: Number(comment.postId), // 💡 Asegurado como Number para sincronía exacta con el Reducer
      userId,
      liked,
      likesCount,
      parentId: comment.parentId ? Number(comment.parentId) : null,
    };

    // 4. Emisión por WebSockets en tiempo real
    getIO().emit("toggleCommentLike", payload);

    // 5. Respuesta HTTP Inmediata
    res.json({
      success: true,
      data: payload,
    });

    // 6. BACKGROUND: Notificación Push (Solo si es LIKE y no es su propio comentario)
    if (liked && comment.userId !== userId) {
      (async () => {
        try {
          const userActor = await User.findByPk(userId, {
            attributes: ["name"],
          });
          const notifUrl = `/comunidad/${comment.postId}`;

          await sendNotificationToUsers({
            recipientIds: [comment.userId],
            actorId: userId,
            type: "comment_like",
            entityId: comment.id,
            title: "Le gustó tu comentario ❤️",
            body: `${userActor?.name || "Alguien"} reaccionó a tu comentario`,
            url: notifUrl,
            extraData: {
              postId: String(comment.postId),
              commentId: String(comment.id),
            },
          });
        } catch (notifErr) {
          console.error(
            "⚠️ Error enviando notificación de comment_like:",
            notifErr,
          );
        }
      })();
    }
  } catch (error) {
    console.error("❌ Error en toggleCommentLike:", error);
    return res.status(500).json({ message: "Error al procesar la reaccion." });
  }
};

const ShowOnePostById = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findByPk(postId, {
      // ... (Mantenemos exactamente el mismo include optimizado que ya tienes)
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage"],
        },
        {
          model: PostMedia,
          as: "media",
          separate: true,
          order: [["order", "ASC"]],
        },
        {
          model: PostLike,
          as: "likes",
          attributes: ["id", "userId"],
        },
        {
          model: PostComment,
          as: "comments",
          where: { parentId: null }, // Solo raíces
          required: false,
          // Añadimos parentId y replyToUserId a los atributos para el formateo
          attributes: [
            "id",
            "content",
            "createdAt",
            "userId",
            "parentId",
            "replyToUserId",
          ],
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "profileImage"],
            },
            {
              model: PostMedia,
              as: "media",
            },
            {
              model: PostCommentLike,
              as: "post_comments_likes",
              attributes: ["id", "userId"],
            },
            {
              model: PostComment,
              as: "replies",
              include: [
                {
                  model: User,
                  as: "user",
                  attributes: ["id", "name", "profileImage"],
                },
                {
                  model: User,
                  as: "replyToUser",
                  attributes: ["id", "name"],
                },
                {
                  model: PostMedia,
                  as: "media",
                },
                {
                  model: PostCommentLike,
                  as: "post_comments_likes",
                  attributes: ["id", "userId"],
                },
              ],
            },
          ],
        },
      ],
      // Mantenemos el ordenamiento
      order: [
        [{ model: PostComment, as: "comments" }, "createdAt", "DESC"],
        [
          { model: PostComment, as: "comments" },
          { model: PostComment, as: "replies" },
          "createdAt",
          "ASC",
        ],
      ],
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post no encontrado",
      });
    }

    // 1. Convertimos a JSON plano para manipular
    const postJson = post.toJSON();

    // 🔥 2. Helper interno para formatear CUALQUIER comentario (raíz o respuesta)
    const formatComment = (comment) => {
      if (!comment) return null;

      return {
        ...comment,
        // Formatear avatar del autor del comentario/respuesta
        user: comment.user
          ? {
              ...comment.user,
              profileImage: comment.user.profileImage
                ? getS3Url(comment.user.profileImage)
                : null,
            }
          : null,

        // Formatear la media adjunta al comentario/respuesta
        media: (comment.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),

        // Formatear recursivamente las respuestas si existen
        replies: (comment.replies || []).map((reply) => formatComment(reply)),

        // Conteos útiles para la UI
        likesCount: comment.post_comments_likes?.length || 0,
        repliesCount: comment.replies?.length || 0,
      };
    };

    // 🔥 3. Formatear el Post Principal
    const postFormatted = {
      ...postJson,

      // Formatear avatar del autor del Post
      user: postJson.user
        ? {
            ...postJson.user,
            profileImage: postJson.user.profileImage
              ? getS3Url(postJson.user.profileImage)
              : null,
          }
        : null,

      // Formatear la media del Post
      media: (postJson.media || []).map((m) => ({
        ...m,
        url: getS3Url(m.url),
      })),

      // 🔥 Formatear Comentarios Raíz usando el helper recursivo
      comments: (postJson.comments || []).map((comment) =>
        formatComment(comment),
      ),

      // Conteos útiles para la UI
      commentsCount: postJson.comments?.length || 0,
      likesCount: postJson.likes?.length || 0,
    };

    // 4. Devolvemos el objeto formateado
    return res.json({
      success: true,
      data: postFormatted,
    });
  } catch (error) {
    console.error("❌ Error al obtener el post:", error);
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createPost,
  getFeed,
  toggleLike,
  addComment,
  ShowOnePostById,
  toggleCommentLike,
};
