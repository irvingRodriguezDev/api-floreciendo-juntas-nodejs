// controllers/post.controller.js
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  Post,
  PostComment,
  PostMedia,
  PostLike,
  User,
  Subscription,
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
const createPost = async (req, res) => {
  const userId = req.user.id;

  const { title, content = "" } = req.body;
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
    const result = await sequelize.transaction(async (t) => {
      // A. Crear post
      const post = await Post.create(
        { userId, title: title.trim(), content: content.trim() },
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
    });

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
    getIO().emit("postCommunityCreated", responsePost);
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
        const usersWithTokens = await User.findAll({
          where: { roleId: 4, isSubscribed: true, id: { [Op.ne]: userId } },
          attributes: ["id"],
          include: [
            {
              model: NotificationToken,
              as: "NotificationTokens",
              where: { isActive: true, device: { [Op.ne]: "safari" } },
              attributes: ["token"],
              required: false,
            },
          ],
        });

        if (usersWithTokens.length > 0) {
          const notifTitle = "Nuevo post 🌸";
          const notifBody = `${req.user.name} publicó un nuevo post`;
          const notifUrl = `/comunidad/${post.id}`;

          // 1. Crear las notificaciones en la DB
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
            { returning: true }, // 💡 Importante para obtener los objetos creados
          );

          // 🔥 2. EMITIR POR SOCKET A CADA USUARIO CONECTADO
          // Como es una comunidad, notificamos a todos los usuarios de la lista
          createdNotifications.forEach((notif) => {
            emitNotification(notif.userId, notif);
          });

          // 3. Recolectar tokens para Push (Firebase)
          const allTokens = usersWithTokens.flatMap((u) =>
            (u.NotificationTokens || []).map((t) => t.token),
          );

          if (allTokens.length > 0) {
            for (let i = 0; i < allTokens.length; i += 500) {
              const batch = allTokens.slice(i, i + 500);
              await sendPushNotificationMulticast({
                tokens: batch,
                title: notifTitle,
                body: notifBody,
                data: { type: "post", postId: String(post.id), url: notifUrl },
              }).catch(() => {});
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
    const { search } = req.query;
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const hasSearch = Boolean(search && search.trim());

    const whereCondition = hasSearch
      ? {
          [Op.or]: [
            { content: { [Op.like]: `%${search}%` } },
            { title: { [Op.like]: `%${search}%` } },
          ],
        }
      : {};

    const queryOptions = {
      where: whereCondition,
      order: [["createdAt", "DESC"]],
      distinct: true,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage"],
        },
        {
          // ✅ Sin separate:true — se resuelve en el JOIN principal
          model: PostMedia,
          as: "media",
          order: [["order", "ASC"]],
        },
        {
          model: PostComment,
          as: "comments",
          attributes: ["id", "content", "createdAt", "userId"],
          // ✅ Limitar comentarios por post
          limit: 10,
          order: [["createdAt", "DESC"]],
          include: [
            {
              // ✅ Sin separate:true
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
      ],
    };

    if (!hasSearch) {
      queryOptions.limit = limit;
      queryOptions.offset = offset;
    }

    const { rows, count } = await Post.findAndCountAll(queryOptions);

    const posts = rows.map((post) => {
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
    });

    res.json({
      success: true,
      data: posts,
      ...(hasSearch
        ? {}
        : {
            pagination: {
              total: count,
              page,
              limit,
              totalPages: Math.ceil(count / limit),
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
          // Guardar en historial (DB)
          const notification = await Notifications.create({
            userId: post.userId,
            actorId: userId,
            type: "like",
            title: "Nueva reacción ❤️",
            body: `${userName} reaccionó a tu publicación`,
            url: `/comunidad/${postId}`,
            data: { postId },
          });
          emitNotification(post.userId, notification);
          // Buscar tokens del dueño del post
          const tokenRows = await NotificationToken.findAll({
            where: {
              userId: post.userId,
              isActive: true,
              device: { [Op.ne]: "safari" },
            },
            attributes: ["token"],
          });

          if (tokenRows.length > 0) {
            const tokens = tokenRows.map((t) => t.token);
            // ✅ USAMOS EL NUEVO MULTICAST (Incluso si es un solo usuario, es más seguro)
            await sendPushNotificationMulticast({
              tokens,
              title: "Han reaccionado a tu publicación",
              body: `${userName} reaccionó a tu publicación`,
              data: {
                type: "like",
                postId: String(postId),
                url: `/comunidad/${postId}`,
              },
            });
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

          emitNotification(post.userId, notification);

          const tokens = await NotificationToken.findAll({
            where: {
              userId: post.userId,
              isActive: true,
              device: { [Op.ne]: "safari" },
            },
            attributes: ["token"],
          });

          if (tokens.length > 0) {
            // Usamos Multicast en lugar de Promise.all(sendPushNotification)
            // Es mucho más eficiente para Firebase
            await sendPushNotificationMulticast({
              tokens: tokens.map((t) => t.token),
              title: "Han comentado tu publicación 💬",
              body: notifBody,
              data: { type: "comment", postId: String(postId), url: notifUrl },
            }).catch((err) => console.error("⚠️ Multicast error:", err));
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
