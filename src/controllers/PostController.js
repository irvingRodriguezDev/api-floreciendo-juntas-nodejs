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
const socketModule = require("../socket");
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

  const user = await User.findByPk(userId);
  try {
    const { title, content } = req.body;
    const files = req.files || [];

    // Validar archivos
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(`Formato no soportado: ${file.originalname}`);
      }
    }

    // 1️⃣ Crear post
    const post = await Post.create(
      { userId, title, content },
      { transaction: t },
    );

    await addPoints(userId, 30, "post_created", post.id, "Publicó un post", t);

    // 2️⃣ Media
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

    // 3️⃣ Post completo
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

    // 4️⃣ WebSocket
    socketModule.getIO().emit("postCommunityCreated", responsePost);

    res.json({ success: true, post: responsePost });
  } catch (error) {
    await t.rollback();

    for (const fileUrl of uploadedFiles) {
      try {
        const key = fileUrl.replace(`${process.env.CLOUDFRONT_URL}/`, "");
        await deleteFromS3(key);
      } catch {}
    }

    return res.status(500).json({ message: error.message });
  }
  if (!responsePost?.id) return;
  try {
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
    const body = `${user.name} publicó un nuevo post`;
    const url = `/comunidad/${responsePost.id}`;

    /**
     * 2️⃣ Guardar notificaciones en DB
     */
    const notifications = usersToNotify.map((u) => ({
      userId: u.id,
      actorId: userId,
      type: "post",
      entityId: responsePost.id,
      title,
      body,
      url,
      data: {
        postId: responsePost.id,
      },
    }));

    await Notifications.bulkCreate(notifications);
    for (const notification of notifications) {
      emitNotification(notification.userId, notification);
    }
    /**
     * 3️⃣ Tokens activos de esos usuarios
     */
    const tokens = await NotificationToken.findAll({
      where: {
        isActive: true,
        userId: usersToNotify.map((u) => u.id),
        device: { [Op.ne]: "safari" },
      },
      attributes: ["token"],
    });

    if (!tokens.length) return;

    /**
     * 4️⃣ Push notifications
     */
    for (const { token } of tokens) {
      await sendPushNotification({
        token,
        title,
        body,
        data: {
          type: "post",
          postId: String(responsePost.id),
          url,
        },
      });
    }
  } catch (err) {
    console.error("⚠️ Error notificaciones post:", err);
  }
};

const getFeed = async (req, res) => {
  try {
    const { search } = req.query;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const hasSearch = Boolean(search && search.trim());

    const whereCondition = hasSearch
      ? {
          [Op.or]: [
            {
              content: {
                [Op.like]: `%${search}%`,
              },
            },
            {
              title: {
                [Op.like]: `%${search}%`,
              },
            },
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
          model: PostMedia,
          as: "media",
          separate: true,
          order: [["order", "ASC"]],
        },
        {
          model: PostComment,
          as: "comments",
          attributes: ["id", "content", "createdAt"],
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
          attributes: ["id"],
        },
      ],
    };

    // 📌 Solo paginar si NO hay búsqueda
    if (!hasSearch) {
      queryOptions.limit = limit;
      queryOptions.offset = offset;
    }

    const { rows, count } = await Post.findAndCountAll(queryOptions);

    const posts = rows.map((post) => {
      const postJson = post.toJSON();

      return {
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

      // 📊 Solo enviar paginación si NO hay búsqueda
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

    const user = await User.findByPk(userId);
    const post = await Post.findByPk(postId);

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

    // 🔌 Socket
    const io = require("../socket").getIO();
    io.emit("postLikeToggled", {
      postId,
      userId,
      liked,
    });

    res.json({ success: true, liked });

    // 🔔 NOTIFICACIÓN (fuera del flujo principal)
    if (liked && post.userId !== userId) {
      try {
        // 1️⃣ Guardar en BD
        const notification = await Notifications.create({
          userId: post.userId,
          actorId: userId,
          type: "like",
          title: "Nueva reacción ❤️",
          body: `${user.name} reaccionó a tu publicación`,
          url: `/comunidad/${postId}`,
          data: { postId },
        });
        emitNotification(post.userId, notification);
        // 2️⃣ Obtener tokens
        const tokens = await NotificationToken.findAll({
          where: {
            isActive: true,
            device: { [Op.ne]: "safari" },
          },
          include: [
            {
              model: User,
              as: "user",
              where: {
                id: post.userId,
                isSubscribed: true,
              },
              attributes: [],
            },
          ],
        });

        // 3️⃣ Push
        for (const tokenRow of tokens) {
          await sendPushNotification({
            token: tokenRow.token,
            title: "Han reaccionado a tu publicación",
            body: `${user.name} reaccionó a tu publicación`,
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
    }
  } catch (error) {
    await t.rollback();
    console.error("❌ toggleLike error:", error);
    res.status(500).json({ message: error.message });
  }
};

const addComment = async (req, res) => {
  const t = await sequelize.transaction();
  const userId = req.user.id;
  const postId = req.params.id;

  const uploadedFiles = [];
  let commentId = null;

  try {
    const user = await User.findByPk(userId);
    const post = await Post.findByPk(postId);

    if (!post) {
      throw new Error("Post no encontrado");
    }

    const { content } = req.body;
    const files = req.files || [];

    // ✅ Validar archivos
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(`Formato no soportado: ${file.originalname}`);
      }
    }

    // 1️⃣ Crear comentario
    const comment = await PostComment.create(
      { postId, userId, content },
      { transaction: t },
    );

    commentId = comment.id;

    // 2️⃣ Puntos
    await addPoints(
      userId,
      20,
      "comment_created",
      commentId,
      "Comentó un post",
      t,
    );

    // 3️⃣ Media
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");
      const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

      const media = await PostMedia.create(
        {
          modelType: "comment",
          modelId: commentId,
          type: isVideo ? "video" : "image",
          order: i,
          url: "UPLOADING",
        },
        { transaction: t },
      );

      const finalPath = await uploadToS3("comment-media", mediaFile, media.id);
      uploadedFiles.push(finalPath);

      await media.update({ url: finalPath }, { transaction: t });
    }

    await t.commit();

    // 4️⃣ Comentario completo
    const fullComment = await PostComment.findByPk(commentId, {
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

    // 5️⃣ WebSocket
    socketModule.getIO().emit("createCommentPostCommunity", {
      postId,
      comment: response,
      userId,
    });

    res.json({ success: true, data: response });

    // 🔔 NOTIFICACIÓN
    if (post.userId !== userId) {
      try {
        // 6️⃣ Guardar en DB
        const notification = await Notifications.create({
          userId: post.userId,
          actorId: userId,
          type: "comment",
          title: "Nuevo comentario 💬",
          body: `${user.name} comentó tu publicación`,
          url: `/comunidad/${postId}`,
          data: {
            postId,
            commentId,
          },
        });
        emitNotification(post.userId, notification);
        // 7️⃣ Tokens
        const tokens = await NotificationToken.findAll({
          where: {
            userId: post.userId,
            isActive: true,
            device: { [Op.ne]: "safari" },
          },
        });

        // 8️⃣ Push
        for (const tokenRow of tokens) {
          await sendPushNotification({
            token: tokenRow.token,
            title: "Han comentado tu publicación 💬",
            body: `${user.name} comentó tu post`,
            data: {
              type: "comment",
              postId: String(postId),
              commentId: String(commentId),
              url: `/comunidad/${postId}`,
            },
          });
        }
      } catch (err) {
        console.error("⚠️ Error enviando notificación comentario:", err);
      }
    }
  } catch (error) {
    if (!t.finished) await t.rollback();

    for (const key of uploadedFiles) {
      try {
        await deleteFromS3(key);
      } catch {}
    }

    console.error("❌ addComment error:", error);
    res.status(500).json({ message: error.message });
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
          attributes: ["id", "content", "createdAt"],
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
