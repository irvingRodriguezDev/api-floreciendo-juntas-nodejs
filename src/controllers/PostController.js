// controllers/post.controller.js
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const { Post, PostComment, PostMedia, PostLike, User } = require("../models");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const socketModule = require("../socket");
const convertImageIfNeeded = require("../helpers/convertImages");
const deleteFromS3 = require("../helpers/deleteFromS3");
const { Op } = require("sequelize");
const { addPoints } = require("../utils/addPoints");
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
  const uploadedFiles = [];

  try {
    const { title, content } = req.body;
    const files = req.files || [];
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(
          `Formato no soportado: ${file.originalname} (${file.mimetype})`,
        );
      }
    }
    // 1️⃣ Crear post
    const post = await Post.create(
      {
        userId: req.user.id,
        title,
        content,
      },
      { transaction: t },
    );
    await addPoints(userId, 30, "post_created", post.id, "Publicó un post", t);
    // 2️⃣ Procesar media
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");

      // Solo convertir imágenes
      const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

      // Crear registro media
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

      // Subir a S3
      const finalPath = await uploadToS3("post-media", mediaFile, media.id);

      // Guardar para rollback manual
      uploadedFiles.push(finalPath);

      // Guardar URL definitiva
      await media.update({ url: finalPath }, { transaction: t });
    }

    // 3️⃣ Commit DB
    await t.commit();

    // 4️⃣ Consultar post completo
    const createdPost = await Post.findByPk(post.id, {
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
    });

    // 5️⃣ Resolver URLs CloudFront
    const postJson = createdPost.toJSON();

    const responsePost = {
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

    // 6️⃣ WebSocket
    const io = socketModule.getIO();
    io.emit("postCommunityCreated", responsePost);

    res.json({
      success: true,
      post: responsePost,
    });
  } catch (error) {
    await t.rollback();

    // 🧹 Limpieza manual de S3
    for (const fileUrl of uploadedFiles) {
      try {
        const key = fileUrl.replace(`${process.env.CLOUDFRONT_URL}/`, "");
        await deleteFromS3(key);
      } catch (err) {
        console.error("❌ Error limpiando S3:", err);
      }
    }

    console.error("❌ createPost error:", error);
    res.status(500).json({ message: error.message });
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

    const existing = await PostLike.findOne({
      where: { postId, userId },
      transaction: t,
      lock: t.LOCK.UPDATE, // 🔒 evita condiciones de carrera
    });

    let liked = false;

    if (existing) {
      await existing.destroy({ transaction: t });
      liked = false;
    } else {
      await PostLike.create({ postId, userId }, { transaction: t });

      await addPoints(
        userId,
        10,
        "reaction",
        postId,
        "Reaccionó a un post",
        t, // 👈 IMPORTANTE
      );

      liked = true;
    }

    await t.commit();

    // 🔌 Emitir socket SOLO si todo fue correcto
    const io = require("../socket").getIO();

    io.emit("postLikeToggled", {
      postId,
      userId,
      liked,
    });

    res.json({ success: true, liked });
  } catch (error) {
    await t.rollback();
    console.error("❌ toggleLike error:", error);
    res.status(500).json({ message: error.message });
  }
};

const addComment = async (req, res) => {
  const t = await sequelize.transaction();
  const userId = req.user.id;
  const uploadedFiles = [];

  try {
    const { content } = req.body;
    const files = req.files || [];
    const postId = req.params.id;

    // 1️⃣ Crear comentario
    const comment = await PostComment.create(
      {
        postId,
        userId,
        content,
      },
      { transaction: t },
    );

    // 2️⃣ Puntos
    await addPoints(
      userId,
      20,
      "comment_created",
      comment.id,
      "Comentó un post",
      t,
    );

    // 3️⃣ Procesar media
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");

      // 🔄 Convertir SOLO imágenes
      const mediaFile = isVideo ? file : await convertImageIfNeeded(file);

      const media = await PostMedia.create(
        {
          modelType: "comment",
          modelId: comment.id,
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

    // 4️⃣ Commit
    await t.commit();

    // 5️⃣ Consultar comentario completo
    const fullComment = await PostComment.findByPk(comment.id, {
      include: [
        {
          model: User,
          attributes: ["id", "name", "profileImage"],
          as: "user",
        },
        {
          model: PostMedia,
          as: "media",
          order: [["order", "ASC"]],
        },
      ],
    });

    // 6️⃣ Normalizar URLs
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

    // 7️⃣ WebSocket
    const io = socketModule.getIO();
    io.emit("createCommentPostCommunity", {
      postId,
      comment: response,
      userId,
    });

    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    if (!t.finished) {
      await t.rollback();
    }

    // 🧹 Limpieza S3 si algo falló
    for (const key of uploadedFiles) {
      try {
        await deleteFromS3(key);
      } catch (err) {
        console.error("❌ Error limpiando S3:", err);
      }
    }

    console.error("❌ addComment error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createPost,
  getFeed,
  toggleLike,
  addComment,
};
