const {
  CommunityPost,
  CommunityComment,
  CommunityReaction,
  User,
} = require("../models");
const sequelize = require("../config/db");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const socketModule = require("../socket");
const { addPoints } = require("../utils/addPoints");

const createPost = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const { courseId, content } = req.body;

    if (!courseId) {
      await t.rollback();
      return res.status(400).json({ message: "courseId es requerido" });
    }

    if (!content || !content.trim()) {
      await t.rollback();
      return res.status(400).json({ message: "content es requerido" });
    }

    // 1️⃣ Crear post
    const post = await CommunityPost.create(
      {
        courseId,
        userId,
        content,
      },
      { transaction: t }
    );

    // 2️⃣ Asignar puntos (MISMA TRANSACCIÓN 🔥)
    await addPoints(userId, 25, "post_created", post.id, "Publicó un post", t);

    // 3️⃣ Subir attachment si existe
    if (req.file) {
      const attachmentUrl = await uploadToS3("posts", req.file, post.id);
      post.attachments = attachmentUrl.replace(/^"|"$/g, "");
      await post.save({ transaction: t });
    }

    // 4️⃣ Commit
    await t.commit();

    // 5️⃣ Emitir socket (FUERA de la transacción)
    const io = socketModule.getIO();
    io.emit("postCreated", post);

    // 6️⃣ Consultar post con autor
    const postWithAuthor = await CommunityPost.findByPk(post.id, {
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "name", "profileImage"],
        },
      ],
    });

    // 7️⃣ Normalizar URLs S3
    if (postWithAuthor?.author?.profileImage) {
      postWithAuthor.author.profileImage = getS3Url(
        postWithAuthor.author.profileImage
      );
    }

    if (postWithAuthor?.attachments) {
      const cleanPath = postWithAuthor.attachments
        .replace(/\\"/g, "")
        .replace(/^"|"$/g, "")
        .replace(/^\//, "");

      postWithAuthor.attachments = getS3Url(cleanPath);
    }

    return res.status(201).json(postWithAuthor);
  } catch (err) {
    await t.rollback();
    console.error("createPost error:", err);

    return res.status(500).json({
      message: "Error al crear post",
      error: err.message,
    });
  }
};

const getPostsByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 10);
    const offset = (page - 1) * limit;

    if (!courseId)
      return res.status(400).json({ message: "courseId es requerido" });

    const { count, rows } = await CommunityPost.findAndCountAll({
      where: { courseId },
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "name", "profileImage"],
        },
        {
          model: CommunityComment,
          as: "comments",
          attributes: ["id", "content", "userId", "createdAt"],
          separate: true,
          limit: 10,
          order: [["createdAt", "DESC"]],
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "profileImage"],
            },
          ],
        },
        {
          model: CommunityReaction,
          as: "reactions",
          attributes: ["type", "userId"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const posts = rows.map((p) => {
      if (!p) return null;

      const reactions = p.reactions || [];

      // Resumen de reacciones
      const summary = reactions.reduce(
        (acc, r) => {
          acc.total += 1;
          acc.byType[r.type] = (acc.byType[r.type] || 0) + 1;
          return acc;
        },
        { total: 0, byType: {} }
      );

      // Formatear attachments del post
      const attachmentUrl = p.attachments
        ? getS3Url(
            String(p.attachments)
              .replace(/\\"/g, "")
              .replace(/^"|"$/g, "")
              .replace(/^\/+/, "")
          )
        : null;

      // Formatear author
      const author = p.author
        ? {
            id: p.author.id,
            name: p.author.name,
            profileImage: p.author.profileImage
              ? getS3Url(p.author.profileImage)
                  .replace(/\\"/g, "")
                  .replace(/^"|"$/g, "")
                  .replace(/([^:]\/)\/+/g, "$1")
                  .trim()
              : null,
          }
        : null;

      // Formatear comentarios con user y su profileImage
      const formattedComments = p.comments.map((c) => ({
        ...c.toJSON(),
        user: c.user
          ? {
              id: c.user.id,
              name: c.user.name,
              profileImage: c.user.profileImage
                ? getS3Url(c.user.profileImage)
                    .replace(/\\"/g, "")
                    .replace(/^"|"$/g, "")
                    .replace(/([^:]\/)\/+/g, "$1")
                    .trim()
                : null,
            }
          : null,
      }));

      return {
        ...p.toJSON(),
        attachments: attachmentUrl,
        author,
        comments: formattedComments,
        reactionsSummary: summary,
        reactions: undefined, // ocultamos array crudo
      };
    });

    return res.json({
      total: count,
      page,
      perPage: limit,
      totalPages: Math.ceil(count / limit),
      posts,
    });
  } catch (error) {
    console.error("Error al obtener publicaciones:", error);
    return res
      .status(500)
      .json({ message: "Error interno del servidor", error: error.message });
  }
};

const getPost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await CommunityPost.findByPk(id, {
      include: [
        { model: User, as: "author", attributes: ["id", "name", "avatar_url"] },
        {
          model: CommunityComment,
          as: "comments",
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "name", "avatar_url"],
            },
          ],
        },
        {
          model: CommunityReaction,
          as: "reactions",
          attributes: ["id", "userId", "type", "createdAt"],
        },
      ],
    });
    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    return res.json(post);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al obtener post", error: err.message });
  }
};

const updatePost = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const post = await CommunityPost.findByPk(id);
    if (!post) return res.status(404).json({ message: "Post no encontrado" });
    if (post.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    // manejar attachments: podrías permitir agregar/remplazar
    let attachments = post.attachments;
    if (req.files && req.files.length) {
      const urls = await uploadToS3(req.files);
      attachments = Array.isArray(attachments)
        ? attachments.concat(urls)
        : urls;
    }

    await post.update(
      { content: content ?? post.content, attachments },
      { transaction: t }
    );
    await t.commit();

    return res.json(post);
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al actualizar post", error: err.message });
  }
};

const deletePost = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await CommunityPost.findByPk(id);
    if (!post) return res.status(404).json({ message: "Post no encontrado" });
    if (post.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    await post.destroy({ transaction: t });
    await t.commit();

    return res.json({ message: "Post eliminado" });
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al eliminar post", error: err.message });
  }
};

module.exports = {
  createPost,
  getPostsByCourse,
  getPost,
  updatePost,
  deletePost,
};
