// controllers/post.controller.js
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  Post,
  PostComment,
  PostMedia,
  PostLike,
  User,
  NotificationToken,
  Notifications,
} = require("../models");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const { getIO } = require("../socket");
const convertImageIfNeeded = require("../helpers/convertImages");
const deleteFromS3 = require("../helpers/deleteFromS3");
const { Op } = require("sequelize");
const { addPoints } = require("../utils/addPoints");
const {
  sendPushNotificationMulticast,
} = require("../services/sendPushNotification");
const emitNotification = require("../helpers/emitNotification");
const moment = require("moment-timezone");
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
  const isPinned = pinned === "true"; // Convierte el string "true" a booleano
  const hours = parseInt(durationHours, 10); // Convierte a número

  const expiryDate = moment().add(hours, "hours").toDate();
  // return console.log(expiryDate, "el expiryDate");

  const files = req.files || [];
  const uploadedFiles = []; // Para rollback de S3 si algo falla

  try {
    /* 1. VALIDACIONES INICIALES (Rápido) */
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

    /* 2. PROCESAMIENTO DE MEDIA (S3) ANTES DE LA DB 🔥 */
    // Subimos a S3 primero. Si esto falla, no habremos ensuciado la DB con registros "UPLOADING"
    const mediaToCreate = [];
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isVideo = file.mimetype.startsWith("video");
        const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

        // Subimos a S3 (Esto toma segundos, pero NO bloquea la base de datos)
        const uniqueId = crypto.randomUUID();
        const finalPath = await uploadToS3("post-media", mediaFile, uniqueId);
        uploadedFiles.push(finalPath);

        mediaToCreate.push({
          modelType: "post",
          type: isVideo ? "video" : "image",
          order: i,
          url: finalPath, // Ya tenemos la URL real
        });
      }
    }

    /* 3. TRANSACCIÓN DE DB (Entrar y Salir volando) ⚡ */
    const result = await withDeadlockRetry(() =>
      sequelize.transaction(async (t) => {
        // A. Crear post
        const post = await Post.create(
          {
            userId,
            title: title.trim(),
            content: content.trim(),
            isPinned: isPinned,
            pinnedUntil: expiryDate,
            type: type,
          },
          { transaction: t },
        );

        // B. Sumar puntos
        await addPoints(
          userId,
          30,
          "post_created",
          post.id,
          "Publicó un post",
          t,
        );

        // C. Crear media con URLs reales
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

    /* 4. CONSTRUCCIÓN DE RESPUESTA FINAL */
    const responsePost = {
      ...post.toJSON(),
      user: {
        id: userId,
        name: req.user.name,
        profileImage: req.user.profileImage
          ? getS3Url(req.user.profileImage)
          : null,
      },
      media: createdMedia.map((m) => ({
        ...m.toJSON(),
        url: getS3Url(m.url), // URL Real de CloudFront/S3
      })),
    };
    getIO().to(`community_${type}`).emit("postCommunityCreated", responsePost);
    // 5. RESPUESTA AL CLIENTE (Ahora sí con todo listo)
    res.json({
      success: true,
      post: responsePost,
      message: "Post publicado exitosamente",
    });

    /* 6. PROCESOS QUE SÍ PUEDEN IR EN BACKGROUND (Notificaciones) */
    // Esto ya no le importa al usuario esperar, pero debe ejecutarse
    (async () => {
      try {
        // 1. Buscar usuarios objetivo (rol 4, suscritos, excluyendo al creador)
        const usersWithTokens = await User.findAll({
          where: { roleId: 4, isSubscribed: true, id: { [Op.ne]: userId } },
          attributes: ["id"],
          include: [
            {
              model: NotificationToken,
              as: "NotificationTokens",
              // 💡 Quitamos la restricción de 'safari' para garantizar que llegue a iOS PWA
              where: { isActive: true },
              attributes: ["token"],
              required: false, // Permite traer usuarios para notif en BD/Socket aunque no tengan Push Token
            },
          ],
        });

        if (usersWithTokens.length > 0) {
          const notifTitle = "Nuevo post 🌸";
          const notifBody = `${req.user.name} publicó un nuevo post`;
          const notifUrl = `/comunidad/${post.id}`;

          // 1. Crear las notificaciones en la DB en lote
          const createdNotifications = await Notifications.bulkCreate(
            usersWithTokens.map((u) => ({
              userId: u.id,
              actorId: userId,
              type: "post",
              entityId: post.id,
              title: notifTitle,
              body: notifBody,
              url: notifUrl,
              data: { postId: post.id },
            })),
            { returning: true },
          );

          // 2. Emitir por Socket en tiempo real a los usuarios conectados
          createdNotifications.forEach((notif) => {
            emitNotification(notif.userId, notif);
          });

          // 3. Recolectar tokens activos para Push (Firebase FCM)
          const allTokens = usersWithTokens.flatMap((u) =>
            (u.NotificationTokens || []).map((t) => t.token),
          );

          // 🔍 LOG DE DEPURACIÓN (Útil para validar en consola local)
          console.log(
            `🚀 Intentando enviar Push a ${allTokens.length} dispositivo(s)...`,
          );

          if (allTokens.length > 0) {
            // Enviar en lotes de 500 (límite de FCM Multicast)
            for (let i = 0; i < allTokens.length; i += 500) {
              const batch = allTokens.slice(i, i + 500);
              await sendPushNotificationMulticast({
                tokens: batch,
                title: notifTitle,
                body: notifBody,
                data: { type: "post", postId: String(post.id), url: notifUrl },
              }).catch((err) => {
                console.error("❌ Error enviando lote Push:", err);
              });
            }
          }
        }
      } catch (err) {
        console.error("❌ Error en Notificaciones Post:", err);
      }
    })();
  } catch (error) {
    // ROLLBACK DE S3: Si la DB falló, borramos lo que subimos a S3 para no dejar basura
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
    const searchCondition = hasSearch
      ? {
          ...baseCondition,
          [Op.or]: [
            { content: { [Op.like]: `%${search}%` } },
            { title: { [Op.like]: `%${search}%` } },
          ],
        }
      : baseCondition;

    const commonInclude = [
      {
        model: User,
        as: "user",
        attributes: ["id", "name", "profileImage"],
      },
      {
        model: PostMedia,
        as: "media",
        order: [["order", "ASC"]],
      },
      {
        model: PostComment,
        as: "comments",
        attributes: ["id", "content", "createdAt", "userId"],
        limit: 10,
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: PostMedia,
            as: "media",
            order: [["order", "ASC"]],
          },
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "profileImage"],
          },
        ],
      },
      {
        model: PostLike,
        as: "likes",
        attributes: ["userId"],
      },
    ];

    const formatPost = (post) => {
      const postJson = post.toJSON();
      const likedByMe = postJson.likes.some((like) => like.userId === userId);
      return {
        ...postJson,
        likedByMe,
        user: {
          ...postJson.user,
          profileImage: postJson.user?.profileImage
            ? getS3Url(postJson.user.profileImage)
            : null,
        },
        media: (postJson.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),
        comments: (postJson.comments || []).map((comment) => ({
          ...comment,
          user: {
            ...comment.user,
            profileImage: comment.user?.profileImage
              ? getS3Url(comment.user.profileImage)
              : null,
          },
          media: (comment.media || []).map((m) => ({
            ...m,
            url: getS3Url(m.url),
          })),
        })),
        commentsCount: postJson.comments?.length || 0,
        likesCount: postJson.likes?.length || 0,
      };
    };

    let posts = [];
    let total = 0;

    if (hasSearch) {
      // Con búsqueda: sin paginación, sin separar fijados
      const { rows, count } = await Post.findAndCountAll({
        where: {
          [Op.and]: [
            baseCondition, // Aquí va el { type }
            searchCondition, // Aquí va el { [Op.or]: [...] }
          ],
        },
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
      // ✅ Página 1: incluir fijados al inicio
      // ✅ Páginas > 1: solo posts normales (isPinned = false)
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
      total = count; // Solo cuenta los normales para la paginación
    }

    res.json({
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
    res.status(500).json({ message: error.message });
  }
};

const toggleLike = async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.user.id;
  const userName = req.user.name;

  try {
    // 1. Buscamos el post rápido (sin transaction/lock)
    const post = await Post.findByPk(postId, { attributes: ["id", "userId"] });
    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    // 2. Intentamos borrar el like primero
    const deletedCount = await PostLike.destroy({
      where: { postId, userId },
    });

    let liked = false;

    if (deletedCount === 0) {
      // Si no borró nada, es que no existía: Creamos el Like
      await PostLike.create({ postId, userId });

      // Puntos fuera de transacción principal (opcional, pero recomendado)
      addPoints(userId, 10, "reaction", postId, "Reaccionó a un post").catch(
        () => {},
      );
      liked = true;
    }

    // 3. Respuesta inmediata
    res.json({ success: true, liked });

    // 4. WebSocket (Fuera del flujo principal)
    getIO().emit("postLikeToggled", { postId: Number(postId), userId, liked });

    // 5. Notificaciones (Solo si es Like y no es mi propio post)

    if (liked && post.userId !== userId) {
      (async () => {
        try {
          const notifTitle = "Nueva reacción ❤️";
          const notifBody = `${userName} reaccionó a tu publicación`;
          const notifUrl = `/comunidad/${postId}`;

          // 1. Guardar en historial (DB)
          const notification = await Notifications.create({
            userId: post.userId,
            actorId: userId,
            type: "like",
            title: notifTitle,
            body: notifBody,
            url: notifUrl,
            data: { postId },
          });

          // 2. Emitir por Socket en tiempo real
          emitNotification(post.userId, notification);

          // 3. Buscar tokens activos del dueño del post
          const tokenRows = await NotificationToken.findAll({
            where: {
              userId: post.userId,
              isActive: true,
            },
            attributes: ["token"],
          });

          if (tokenRows.length > 0) {
            const tokens = tokenRows.map((t) => t.token);

            // 4. Enviar Push Nativo vía FCM Multicast
            await sendPushNotificationMulticast({
              tokens,
              title: notifTitle,
              body: notifBody,
              data: {
                type: "like",
                postId: String(postId),
                url: notifUrl,
              },
            }).catch((pushErr) =>
              console.error("❌ Error en Push Like:", pushErr),
            );
          }
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
  const postId = req.params.id;
  const uploadedFiles = [];
  const files = req.files || [];

  try {
    /* 1. VALIDACIONES Y PREPARACIÓN (Fuera de la DB) */
    const { content } = req.body;

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res
          .status(400)
          .json({ message: `Formato no soportado: ${file.originalname}` });
      }
    }

    const [user, post] = await Promise.all([
      User.findByPk(userId, { attributes: ["id", "name", "profileImage"] }),
      Post.findByPk(postId, { attributes: ["id", "userId"] }),
    ]);

    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    /* 2. TRABAJO PESADO (S3) ANTES DE LA TRANSACCIÓN 🔥 */
    // Subimos todo a S3 primero. Si esto falla, la DB ni se entera.
    const mediaToCreate = await Promise.all(
      files.map(async (file, i) => {
        const isVideo = file.mimetype.startsWith("video");
        const mediaFile = isVideo ? file : await convertImageIfNeeded(file);
        const uniqueId = crypto.randomUUID();
        // El tercer parámetro (id) no lo tenemos aún, así que uploadToS3 debe manejar un nombre único
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

    /* 3. TRANSACCIÓN EXPRESS (Solo escrituras rápidas) ⚡ */
    const fullComment = await sequelize.transaction(async (t) => {
      // Crear comentario
      const comment = await PostComment.create(
        { postId, userId, content: content },
        { transaction: t },
      );

      // Puntos
      await addPoints(
        userId,
        20,
        "comment_created",
        comment.id,
        "Comentó un post",
        t,
      );

      // Crear Media con URLs reales
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

      // Devolvemos el objeto construido manualmente para evitar OTRA query (findByPk)

      // Esto ahorra aún más tiempo de conexión
      return {
        ...comment.get({ clone: true }),
        user: user,
        media: createdMedia,
      };
    });

    /* 4. FORMATEO DE RESPUESTA */
    const response = {
      ...fullComment,
      user: {
        id: user.id,
        name: user.name,
        profileImage: user.profileImage ? getS3Url(user.profileImage) : null,
      },
      media: (fullComment.media || []).map((m) => ({
        ...m.get(),
        url: getS3Url(m.url),
      })),
    };
    getIO().emit("createCommentPostCommunity", {
      postId,
      comment: response,
      userId, // A veces el frontend usa esto para scroll automático
    });
    // Respuesta inmediata con todo listo
    res.json({ success: true, data: response });

    /* 5. BACKGROUND (Notificaciones y Sockets) */
    (async () => {
      try {
        if (post.userId !== userId) {
          const notifTitle = "Nuevo comentario 💬";
          const notifBody = `${user.name} comentó tu publicación`;
          const notifUrl = `/comunidad/${postId}`;

          // 1. Guardar en BD para el centro de notificaciones
          const notification = await Notifications.create({
            userId: post.userId,
            actorId: userId,
            type: "comment",
            entityId: fullComment.id,
            title: notifTitle,
            body: notifBody,
            url: notifUrl,
            data: { postId, commentId: fullComment.id },
          });

          // 2. Emitir por Socket en tiempo real
          emitNotification(post.userId, notification);

          // 3. Buscar tokens activos de FCM
          const tokens = await NotificationToken.findAll({
            where: {
              userId: post.userId,
              isActive: true,
            },
            attributes: ["token"],
          });

          if (tokens.length > 0) {
            // 4. Enviar notificación Push nativa vía FCM Multicast
            await sendPushNotificationMulticast({
              tokens: tokens.map((t) => t.token),
              title: notifTitle, // 👈 Usamos la misma variable para consistencia
              body: notifBody,
              data: {
                type: "comment",
                postId: String(postId),
                commentId: String(fullComment.id), // 💡 Útil si quieres hacer scroll al comentario en el cliente
                url: notifUrl,
              },
            }).catch((err) =>
              console.error("⚠️ Multicast error en comentario:", err),
            );
          }
        }
      } catch (err) {
        console.error("⚠️ Error background addComment:", err);
      }
    })();
  } catch (error) {
    // Si algo falló en la DB, borramos los archivos que ya subimos a S3
    for (const path of uploadedFiles) {
      try {
        await deleteFromS3(path);
      } catch {}
    }
    console.error("❌ addComment error:", error);
    if (!res.headersSent) res.status(500).json({ message: error.message });
  }
};
const ShowOnePostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user?.id || null;

    const post = await Post.findOne({
      where: { id: postId },
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
          model: PostComment,
          as: "comments",
          attributes: ["id", "content", "createdAt", "userId"],
          order: [["createdAt", "ASC"]], // 🔥 importante
          include: [
            {
              model: PostMedia,
              as: "media",
              separate: true,
              order: [["order", "ASC"]],
            },
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "profileImage"],
            },
          ],
        },
        {
          model: PostLike,
          as: "likes",
          attributes: ["userId"], // 🔥 optimizado
        },
      ],
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post no encontrado",
      });
    }

    const postJson = post.toJSON();

    // ❤️ Like del usuario actual
    const isLikedByMe = userId
      ? postJson.likes.some((l) => l.userId === userId)
      : false;

    const postFormatted = {
      id: postJson.id,
      title: postJson.title,
      content: postJson.content,
      createdAt: postJson.createdAt,

      user: {
        ...postJson.user,
        profileImage: postJson.user?.profileImage
          ? getS3Url(postJson.user.profileImage)
          : null,
      },

      media: (postJson.media || []).map((m) => ({
        ...m,
        url: getS3Url(m.url),
      })),

      comments: (postJson.comments || []).map((comment) => ({
        ...comment,
        user: {
          ...comment.user,
          profileImage: comment.user?.profileImage
            ? getS3Url(comment.user.profileImage)
            : null,
        },
        media: (comment.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),
      })),

      commentsCount: postJson.comments?.length || 0,
      likesCount: postJson.likes?.length || 0,

      isLikedByMe, // 🔥 UX PRO
    };

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
};
