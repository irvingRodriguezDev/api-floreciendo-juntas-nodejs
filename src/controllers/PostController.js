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
const sendPushNotification = require("../services/sendPushNotification");
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
  const t = await sequelize.transaction();
  const userId = req.user.id;

  let responsePost = null;
  const uploadedFiles = [];

  try {
    const { title, content = "" } = req.body;
    const files = req.files || [];

    /* ======================
       Validaciones básicas
    ====================== */
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "El título es obligatorio" });
    }

    if (title.length > 120) {
      return res
        .status(400)
        .json({ message: "El título excede el límite permitido" });
    }

    if (!content.trim()) {
      return res.status(400).json({ message: "El contenido es obligatorio" });
    }

    if (content.length > 1500) {
      return res
        .status(400)
        .json({ message: "El contenido es demasiado largo" });
    }

    if (files.length > 4) {
      return res.status(400).json({ message: "Máximo 4 archivos permitidos" });
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return res.status(400).json({ message: "Archivo demasiado grande" });
      }

      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          message: `Formato no soportado: ${file.originalname}`,
        });
      }
    }

    /* ======================
       Usuario
    ====================== */
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    /* ======================
       Crear post
    ====================== */
    const post = await Post.create(
      { userId, title: title.trim(), content: content.trim() },
      { transaction: t },
    );

    await addPoints(userId, 30, "post_created", post.id, "Publicó un post", t);

    /* ======================
       Media
    ====================== */
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");
      const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

      const media = await PostMedia.create(
        {
          modelId: post.id,
          modelType: "post",
          type: isVideo ? "video" : "image",
          order: i,
          url: "UPLOADING",
        },
        { transaction: t },
      );

      const finalPath = await uploadToS3("post-media", mediaFile, media.id);
      uploadedFiles.push(finalPath);

      await media.update({ url: finalPath }, { transaction: t });
    }

    await t.commit();

    /* ======================
       Post completo
    ====================== */
    const createdPost = await Post.findByPk(post.id, {
      include: [
        { model: PostMedia, as: "media", order: [["order", "ASC"]] },
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage"],
        },
      ],
    });

    const postJson = createdPost.toJSON();

    responsePost = {
      ...postJson,
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
    };

    /* ======================
       WebSocket
    ====================== */
    const io = getIO();
    io.emit("postCommunityCreated", responsePost);

    res.json({ success: true, post: responsePost });
  } catch (error) {
    await t.rollback();

    for (const fileUrl of uploadedFiles) {
      try {
        const key = fileUrl.replace(`${process.env.CLOUDFRONT_URL}/`, "");
        await deleteFromS3(key);
      } catch (err) {
        console.error("Error limpiando S3:", err);
      }
    }

    return res.status(500).json({ message: error.message });
  }

  /* ======================
     Notificaciones
  ====================== */
  try {
    if (!responsePost?.id) return;

    const usersToNotify = await User.findAll({
      where: {
        roleId: 4,
        isSubscribed: true,
        id: { [Op.ne]: userId },
      },
      attributes: ["id"],
    });

    if (!usersToNotify.length) return;

    const title = "Nuevo post 🌸";
    const body = `${responsePost.user.name} publicó un nuevo post`;
    const url = `/comunidad/${responsePost.id}`;

    // 1️⃣ Guardar notificaciones en DB
    const notifications = usersToNotify.map((u) => ({
      userId: u.id,
      actorId: userId,
      type: "post",
      entityId: responsePost.id,
      title,
      body,
      url,
      data: { postId: responsePost.id },
    }));

    await Notifications.bulkCreate(notifications);

    // 2️⃣ Emitir por socket (igual que antes)
    notifications.forEach((n) => emitNotification(n.userId, n));

    // 3️⃣ Tokens activos
    const tokens = await NotificationToken.findAll({
      where: {
        isActive: true,
        userId: usersToNotify.map((u) => u.id),
        device: { [Op.ne]: "safari" },
      },
      attributes: ["token"],
    });

    if (!tokens.length) return;

    // 4️⃣ Push (NO BLOQUEANTE 🔥)
    for (const { token } of tokens) {
      sendPushNotification({
        token,
        title,
        body,
        data: {
          type: "post",
          postId: String(responsePost.id),
          url,
        },
      }).catch(() => {});
    }
  } catch (err) {
    console.error("⚠️ Error notificaciones post:", err);
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
  const t = await sequelize.transaction();

  try {
    const { id: postId } = req.params;
    const userId = req.user.id;

    // ✅ req.user ya tiene el nombre — no necesitamos query extra
    const userName = req.user.name;

    const post = await Post.findByPk(postId, {
      attributes: ["id", "userId"],
      transaction: t,
    });

    if (!post) {
      await t.rollback();
      return res.status(404).json({ message: "Post no encontrado" });
    }

    const existing = await PostLike.findOne({
      where: { postId, userId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let liked = false;

    if (existing) {
      await existing.destroy({ transaction: t });
      liked = false;
    } else {
      await PostLike.create({ postId, userId }, { transaction: t });
      await addPoints(userId, 10, "reaction", postId, "Reaccionó a un post", t);
      liked = true;
    }

    await t.commit();

    const io = getIO();
    io.emit("postLikeToggled", {
      postId: Number(postId),
      userId,
      liked,
    });

    res.json({ success: true, liked });

    if (liked && post.userId !== userId) {
      setImmediate(async () => {
        try {
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

          const tokens = await NotificationToken.findAll({
            where: { isActive: true, device: { [Op.ne]: "safari" } },
            attributes: ["token"],
            include: [
              {
                model: User,
                as: "user",
                where: { id: post.userId, isSubscribed: true },
                attributes: [],
              },
            ],
          });

          // ✅ Push notifications en paralelo
          await Promise.all(
            tokens.map((tokenRow) =>
              sendPushNotification({
                token: tokenRow.token,
                title: "Han reaccionado a tu publicación",
                body: `${userName} reaccionó a tu publicación`,
                data: {
                  type: "like",
                  postId: String(postId),
                  url: `/comunidad/${postId}`,
                },
              }).catch((e) => console.error("Push error:", e)),
            ),
          );
        } catch (err) {
          console.error("❌ Error notificación like:", err);
        }
      });
    }
  } catch (error) {
    if (t) await t.rollback();
    console.error("❌ toggleLike error:", error);
    res.status(500).json({ message: error.message });
  }
};

const addComment = async (req, res) => {
  const userId = req.user.id;
  const postId = req.params.id;
  const uploadedFiles = [];
  let commentId = null;

  try {
    // ✅ Validar archivos ANTES de tocar la BD
    const files = req.files || [];
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res
          .status(400)
          .json({ message: `Formato no soportado: ${file.originalname}` });
      }
    }

    const { content } = req.body;

    // ✅ Buscar user y post en paralelo ANTES de la transacción
    const [user, post] = await Promise.all([
      User.findByPk(userId, { attributes: ["id", "name", "profileImage"] }),
      Post.findByPk(postId, { attributes: ["id", "userId"] }),
    ]);

    if (!post) {
      return res.status(404).json({ message: "Post no encontrado" });
    }

    // ✅ Transacción solo para las escrituras
    const fullComment = await sequelize.transaction(async (t) => {
      const comment = await PostComment.create(
        { postId, userId, content },
        { transaction: t },
      );

      commentId = comment.id;

      // ✅ addPoints dentro de la transacción
      await addPoints(
        userId,
        20,
        "comment_created",
        commentId,
        "Comentó un post",
        t,
      );

      // ✅ Media — uploads en paralelo
      if (files.length > 0) {
        const mediaRecords = await PostMedia.bulkCreate(
          files.map((file, i) => ({
            modelType: "comment",
            modelId: commentId,
            type: file.mimetype.startsWith("video") ? "video" : "image",
            order: i,
            url: "UPLOADING",
          })),
          { transaction: t },
        );

        // ✅ Procesar y subir todos los archivos en paralelo
        const uploadResults = await Promise.all(
          files.map(async (file, i) => {
            const isVideo = file.mimetype.startsWith("video");
            const mediaFile = isVideo ? file : await convertImageIfNeeded(file);
            const finalPath = await uploadToS3(
              "comment-media",
              mediaFile,
              mediaRecords[i].id,
            );
            uploadedFiles.push(finalPath);
            return { record: mediaRecords[i], finalPath };
          }),
        );

        // ✅ Actualizar urls en paralelo
        await Promise.all(
          uploadResults.map(({ record, finalPath }) =>
            record.update({ url: finalPath }, { transaction: t }),
          ),
        );
      }

      // ✅ Query final dentro de la transacción
      return await PostComment.findByPk(commentId, {
        transaction: t,
        include: [
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
        ],
      });
    });

    const response = {
      ...fullComment.toJSON(),
      user: {
        ...fullComment.user.toJSON(),
        profileImage: fullComment.user.profileImage
          ? getS3Url(fullComment.user.profileImage)
          : null,
      },
      media: fullComment.media.map((m) => ({
        ...m.toJSON(),
        url: getS3Url(m.url),
      })),
    };

    // ✅ Responder al usuario ANTES de procesar notificaciones
    res.json({ success: true, data: response });

    const io = getIO();
    io.emit("createCommentPostCommunity", {
      postId,
      comment: response,
      userId,
    });

    // ✅ Notificaciones fuera de la transacción y sin bloquear respuesta
    if (post.userId !== userId) {
      try {
        const notification = await Notifications.create({
          userId: post.userId,
          actorId: userId,
          type: "comment",
          title: "Nuevo comentario 💬",
          body: `${user.name} comentó tu publicación`,
          url: `/comunidad/${postId}`,
          data: { postId, commentId },
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

        // ✅ Todas las push notifications en paralelo
        await Promise.all(
          tokens.map((tokenRow) =>
            sendPushNotification({
              token: tokenRow.token,
              title: "Han comentado tu publicación 💬",
              body: `${user.name} comentó tu post`,
              data: {
                type: "comment",
                postId: String(postId),
                commentId: String(commentId),
                url: `/comunidad/${postId}`,
              },
            }).catch((err) => console.error("⚠️ Push error:", err)),
          ),
        );
      } catch (err) {
        console.error("⚠️ Error enviando notificación comentario:", err);
      }
    }
  } catch (error) {
    for (const key of uploadedFiles) {
      try {
        await deleteFromS3(key);
      } catch {}
    }
    console.error("❌ addComment error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    }
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
