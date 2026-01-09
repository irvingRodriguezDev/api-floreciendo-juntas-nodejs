// controllers/post.controller.js
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const path = require("path");
const { Post, PostComment, PostMedia, PostLike, User } = require("../models");
const getS3Url = require("../helpers/getS3Url");
const sequelize = require("../config/db");
const createPost = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { title, content } = req.body;
    const files = req.files || [];

    // 1️⃣ Crear post
    const post = await Post.create(
      {
        userId: req.user.id,
        title,
        content,
      },
      { transaction: t }
    );

    // 2️⃣ Procesar media (polimórfica)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");

      // Crear registro media
      const media = await PostMedia.create(
        {
          modelId: post.id,
          modelType: "post",
          type: isVideo ? "video" : "image",
          order: i,
          url: "url",
        },
        { transaction: t }
      );

      // Subir a S3
      const finalPath = await uploadToS3("post-media", file, media.id);

      // Guardar path
      await media.update({ url: finalPath }, { transaction: t });
    }

    // 3️⃣ Commit
    await t.commit();

    // 4️⃣ Volver a consultar post
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

    // 5️⃣ Resolver URLs
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

    res.json({
      success: true,
      post: responsePost,
    });
  } catch (error) {
    await t.rollback();
    console.error("❌ createPost error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const { rows, count } = await Post.findAndCountAll({
      order: [["createdAt", "DESC"]],
      limit,
      offset,
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
          separate: true, // 👈 evita duplicados y errores de order
          order: [["order", "ASC"]],
        },
        {
          model: PostComment,
          as: "comments",
          attributes: ["id", "content"],
          include: [
            {
              model: PostMedia,
              as: "media",
              separate: true, // 👈 evita duplicados y errores de order
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
    });

    const posts = rows.map((post) => {
      const postJson = post.toJSON();

      return {
        ...postJson,

        // 👤 Usuario con imagen resuelta (MISMO alias)
        user: {
          ...postJson.user,
          profileImage: postJson.user?.profileImage
            ? getS3Url(postJson.user.profileImage)
            : null,
        },

        // 🖼 Media del post
        media: (postJson.media || []).map((m) => ({
          ...m,
          url: getS3Url(m.url),
        })),

        // 📊 Contadores correctos
        commentsCount: postJson.comments?.length || 0,
        likesCount: postJson.likes?.length || 0,
      };
    });

    res.json({
      success: true,
      data: posts,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("❌ getFeed error:", error);
    res.status(500).json({ message: error.message });
  }
};

const toggleLike = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const existing = await PostLike.findOne({
    where: { postId: id, userId },
  });

  if (existing) {
    await existing.destroy();
    return res.json({ liked: false });
  }

  await PostLike.create({ postId: id, userId });
  res.json({ liked: true });
};

const addComment = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { content } = req.body;
    const files = req.files || [];
    const postId = req.params.id;

    // 1️⃣ Crear comentario
    const comment = await PostComment.create(
      {
        postId,
        userId: req.user.id,
        content,
      },
      { transaction: t }
    );

    // 2️⃣ Procesar media (opcional)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.mimetype.startsWith("video");

      const media = await PostMedia.create(
        {
          modelType: "comment",
          modelId: comment.id,
          type: isVideo ? "video" : "image",
          order: i,
          url: "tmp",
        },
        { transaction: t }
      );

      const finalPath = await uploadToS3("comment-media", file, media.id);

      await media.update({ url: finalPath }, { transaction: t });
    }

    // 3️⃣ Commit SOLO si todo salió bien
    await t.commit();

    // 4️⃣ Consultar comentario (FUERA de la transacción)
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

    // 5️⃣ Resolver URLs
    const response = {
      ...fullComment.toJSON(),
      User: {
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

    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    // 🔒 Solo rollback si NO se ha hecho commit
    if (!t.finished) {
      await t.rollback();
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
