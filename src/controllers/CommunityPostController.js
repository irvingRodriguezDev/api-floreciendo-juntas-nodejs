const {
  CommunityPost,
  CommunityComment,
  CommunityReaction,
  User,
  sequelize,
} = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");

const createPost = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { courseId, content } = req.body;

    if (!courseId)
      return res.status(400).json({ message: "courseId es requerido" });
    if (!content || !content.trim())
      return res.status(400).json({ message: "content es requerido" });

    // manejar attachments si vienen (req.files)
    let attachments = null;
    if (req.files && req.files.length) {
      const urls = await uploadToS3(req.files);
      attachments = urls;
    }

    const post = await CommunityPost.create(
      { courseId, userId, content, attachments },
      { transaction: t }
    );
    await t.commit();

    // devolver con autor vacío (puedes incluir author)
    const postWithAuthor = await CommunityPost.findByPk(post.id, {
      include: [
        { model: User, as: "author", attributes: ["id", "name", "avatar_url"] },
      ],
    });

    return res.status(201).json(postWithAuthor);
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al crear post", error: err.message });
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
        { model: User, as: "author", attributes: ["id", "name", "avatar_url"] },
        // incluir conteos o primeros comentarios si quieres
        {
          model: CommunityComment,
          as: "comments",
          attributes: ["id", "content", "userId", "createdAt"],
          limit: 2,
          order: [["createdAt", "DESC"]],
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

    // Agregar resumen de reacciones por post (map)
    const posts = rows.map((p) => {
      const reactions = p.reactions || [];
      const summary = reactions.reduce((acc, r) => {
        acc.total = (acc.total || 0) + 1;
        acc.byType = acc.byType || {};
        acc.byType[r.type] = (acc.byType[r.type] || 0) + 1;
        return acc;
      }, {});
      return {
        ...p.toJSON(),
        reactionsSummary: summary,
        reactions: undefined, // ya resumido
      };
    });

    return res.json({ total: count, page, perPage: limit, posts });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al obtener posts", error: err.message });
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
