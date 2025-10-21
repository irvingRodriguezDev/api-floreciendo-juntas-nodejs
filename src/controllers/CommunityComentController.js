const {
  CommunityComment,
  CommunityPost,
  CommunityReaction,
  User,
  sequelize,
} = require("../models");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");

const createComment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { postId, content } = req.body;

    if (!postId) return res.status(400).json({ message: "postId requerido" });
    if (!content || !content.trim())
      return res.status(400).json({ message: "content requerido" });

    // verificar existencia del post
    const post = await CommunityPost.findByPk(postId);
    if (!post) return res.status(404).json({ message: "Post no encontrado" });

    let attachments = null;
    if (req.files && req.files.length) {
      attachments = await uploadToS3(req.files);
    }

    const comment = await CommunityComment.create(
      { postId, userId, content, attachments },
      { transaction: t }
    );
    await t.commit();

    const commentWithUser = await CommunityComment.findByPk(comment.id, {
      include: [
        { model: User, as: "user", attributes: ["id", "name", "avatar_url"] },
      ],
    });

    return res.status(201).json(commentWithUser);
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al crear comentario", error: err.message });
  }
};

const getCommentsByPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 10);
    const offset = (page - 1) * limit;

    if (!postId) return res.status(400).json({ message: "postId requerido" });

    const { count, rows } = await CommunityComment.findAndCountAll({
      where: { postId },
      include: [
        { model: User, as: "user", attributes: ["id", "name", "avatar_url"] },
      ],
      order: [["createdAt", "ASC"]],
      limit,
      offset,
    });

    return res.json({ total: count, page, perPage: limit, comments: rows });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al obtener comentarios", error: err.message });
  }
};

const updateComment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const comment = await CommunityComment.findByPk(id);
    if (!comment)
      return res.status(404).json({ message: "Comentario no encontrado" });
    if (comment.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    let attachments = comment.attachments;
    if (req.files && req.files.length) {
      const urls = await uploadToS3(req.files);
      attachments = Array.isArray(attachments)
        ? attachments.concat(urls)
        : urls;
    }

    await comment.update(
      { content: content ?? comment.content, attachments },
      { transaction: t }
    );
    await t.commit();

    return res.json(comment);
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al actualizar comentario", error: err.message });
  }
};

const deleteComment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const comment = await CommunityComment.findByPk(id);
    if (!comment)
      return res.status(404).json({ message: "Comentario no encontrado" });
    if (comment.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    await comment.destroy({ transaction: t });
    await t.commit();

    return res.json({ message: "Comentario eliminado" });
  } catch (err) {
    await t.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al eliminar comentario", error: err.message });
  }
};

module.exports = {
  createComment,
  getCommentsByPost,
  updateComment,
  deleteComment,
};
