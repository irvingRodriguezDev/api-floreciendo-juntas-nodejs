const {
  CommunityReaction,
  CommunityPost,
  CommunityComment,
  User,
} = require("../models");
const sequelize = require("../config/db");
const { Op, fn, col } = require("sequelize");
const socketModule = require("../socket");
const { addPoints } = require("../utils/addPoints");
const toggleReaction = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { postId = null, commentId = null, type } = req.body;

    if (!type) return res.status(400).json({ message: "type es requerido" });
    if (!postId && !commentId)
      return res.status(400).json({ message: "postId o commentId requerido" });
    if (postId && commentId)
      return res
        .status(400)
        .json({ message: "Solo postId o commentId, no ambos" });

    // Verificar existencia del objetivo
    if (postId) {
      const post = await CommunityPost.findByPk(postId);
      if (!post) return res.status(404).json({ message: "Post no encontrado" });
    } else {
      const comment = await CommunityComment.findByPk(commentId);
      if (!comment)
        return res.status(404).json({ message: "Comentario no encontrado" });
    }

    // Buscar si el usuario ya tiene una reacción
    const existingReaction = await CommunityReaction.findOne({
      where: { userId, postId, commentId },
      transaction: t,
    });

    if (existingReaction) {
      // Si ya existe, actualizar el tipo
      if (existingReaction.type !== type) {
        existingReaction.type = type;
        await existingReaction.save({ transaction: t });
      }
    } else {
      // Si no existe, crear nueva reacción
      await CommunityReaction.create(
        { userId, type, postId, commentId },
        { transaction: t }
      );
    }
    await addPoints(
      req.user.id,
      10,
      "reaction",
      CommunityReaction.id,
      "Reaccionó a un post"
    );
    await t.commit();

    // Obtener todas las reacciones del objetivo para emitir
    const reactions = await CommunityReaction.findAll({
      where: { postId, commentId },
      include: [
        { model: User, as: "user", attributes: ["id", "name", "profileImage"] },
      ],
    });

    const io = socketModule.getIO();
    io.emit("reactionUpdated", { postId, commentId, reactions });

    return res.json({
      message: "Reacción actualizada correctamente",
      reactions,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error(err);
    return res.status(500).json({
      message: "Error al togglear reacción",
      error: err.message,
    });
  }
};

const getReactionsSummary = async (req, res) => {
  try {
    const { postId = null, commentId = null } = req.query;

    if (!postId && !commentId) {
      return res
        .status(400)
        .json({ message: "Se requiere postId o commentId" });
    }
    const postIdNum = postId ? parseInt(postId, 10) : null;
    const commentIdNum = commentId ? parseInt(commentId, 10) : null;

    const where = postId ? { postId: postIdNum } : { commentId: commentIdNum };

    const reactions = await CommunityReaction.findAll({
      where: {
        [Op.or]: [
          postIdNum ? { postId: postIdNum } : null,
          commentIdNum ? { commentId: commentIdNum } : null,
        ].filter(Boolean), // elimina nulls si alguno no existe
      },
      attributes: ["type", [fn("COUNT", col("type")), "count"]],
      group: ["type"],
    });

    const summary = {};
    reactions.forEach((r) => {
      summary[r.type] = parseInt(r.get("count"), 10);
    });

    return res.json({
      ...(postIdNum && { postId: postIdNum }),
      ...(commentIdNum && { commentId: commentIdNum }),
      summary,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Error al obtener resumen de reacciones",
      error: err.message,
    });
  }
};

const getReactionsSummaryMultiple = async (req, res) => {
  try {
    const { postIds, userId } = req.query; // postIds=1,2,3 & userId=5

    if (!postIds) {
      return res.status(400).json({ message: "Se requieren postIds" });
    }

    if (!userId) {
      return res.status(400).json({ message: "Se requiere userId" });
    }

    const ids = postIds.split(",").map((id) => parseInt(id, 10));
    const uid = parseInt(userId, 10);

    // Obtener todas las reacciones para esos posts
    const reactions = await CommunityReaction.findAll({
      where: { postId: ids },
      attributes: [
        "postId",
        "type",
        "userId",
        [fn("COUNT", col("type")), "count"],
      ],
      group: ["postId", "type", "userId"],
    });

    // Agrupar por postId
    const summaryByPost = {};
    reactions.forEach((r) => {
      const pid = r.postId;
      if (!summaryByPost[pid])
        summaryByPost[pid] = { summary: {}, userReaction: null };

      // Contar las reacciones
      summaryByPost[pid].summary[r.type] =
        (summaryByPost[pid].summary[r.type] || 0) +
        parseInt(r.get("count"), 10);

      // Verificar si esta es la reacción del usuario
      if (r.userId === uid) {
        summaryByPost[pid].userReaction = r.type;
      }
    });

    return res.json(summaryByPost);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Error al obtener resúmenes de reacciones",
      error: err.message,
    });
  }
};

module.exports = {
  toggleReaction,
  getReactionsSummary,
  getReactionsSummaryMultiple,
};
