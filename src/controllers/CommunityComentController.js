const {
  CommunityComment,
  CommunityPost,
  CommunityReaction,
  User,
} = require("../models");
const sequelize = require("../config/db");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const socketModule = require("../socket");
const getS3Url = require("../helpers/getS3Url");
const { addPoints } = require("../utils/addPoints");
const createComment = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const userId = req.user.id; // 🔐 seguro
    const { postId, content } = req.body;

    if (!postId) {
      await t.rollback();
      return res.status(400).json({ message: "postId requerido" });
    }

    if (!content || !content.trim()) {
      await t.rollback();
      return res.status(400).json({ message: "content requerido" });
    }

    // Verificar post (fuera de transacción)
    const post = await CommunityPost.findByPk(postId);
    if (!post) {
      await t.rollback();
      return res.status(404).json({ message: "Post no encontrado" });
    }

    // 1️⃣ Crear comentario (SIN attachments todavía)
    const newComment = await CommunityComment.create(
      {
        postId,
        userId,
        content,
        attachments: null,
      },
      { transaction: t },
    );

    // 2️⃣ Sumar puntos (MISMA transacción 🔥)
    await addPoints(
      userId,
      25,
      "custom",
      newComment.id,
      `Realizo un comentario a un post de un curso, el post de curso: ${postId}`,
      t,
    );

    // 3️⃣ Commit
    await t.commit();

    // ---------- FUERA DE LA TRANSACCIÓN ----------

    // 4️⃣ Subir archivos a S3
    if (req.files && req.files.length) {
      const attachments = await uploadToS3(
        "comments",
        req.files,
        newComment.id,
      );
      newComment.attachments = attachments;
      await newComment.save(); // fuera de t
    }

    // 5️⃣ Recargar con usuario
    await newComment.reload({
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "profileImage"],
        },
      ],
    });

    // 6️⃣ Normalizar URLs
    if (newComment.user?.profileImage) {
      newComment.user.profileImage = getS3Url(newComment.user.profileImage);
    }

    if (newComment.attachments) {
      newComment.attachments = getS3Url(newComment.attachments);
    }

    // 7️⃣ Emitir socket
    const io = socketModule.getIO();
    io.emit("commentCreated", {
      postId,
      comment: newComment,
    });

    return res.status(201).json(newComment);
  } catch (err) {
    if (!t.finished) await t.rollback();

    console.error("❌ Error al crear comentario:", err);
    return res.status(500).json({
      message: "Error al crear comentario",
      error: err.message,
    });
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
        { model: User, as: "user", attributes: ["id", "name", "profileImage"] },
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
      { transaction: t },
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
