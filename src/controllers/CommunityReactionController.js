const {
  CommunityReaction,
  CommunityPost,
  CommunityComment,
} = require("../models");
const sequelize = require("../config/db");
const { Op, fn, col } = require("sequelize");
const socketModule = require("../socket");
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

    // Buscar si ya existe una reacción igual
    const where = { userId, type, postId, commentId };
    const existing = await CommunityReaction.findOne({ where });

    if (existing) {
      await existing.destroy({ transaction: t });
      await t.commit();
      return res.json({ action: "removed", message: "Reacción removida" });
    } else {
      await CommunityReaction.create(
        { userId, type, postId, commentId },
        { transaction: t }
      );
      await t.commit();
      const io = socketModule.getIO();
      io.emit("reactionUpdated", { postId, reactions });
      return res
        .status(201)
        .json({ action: "created", message: "Reacción creada" });
    }
  } catch (err) {
    await t.rollback();
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Ya reaccionaste con ese tipo" });
    }
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

    const where = postId ? { postId } : { commentId };

    const reactions = await CommunityReaction.findAll({
      where,
      attributes: ["type", [fn("COUNT", col("type")), "count"]],
      group: ["type"],
    });

    const summary = {};
    reactions.forEach((r) => {
      summary[r.type] = parseInt(r.get("count"), 10);
    });

    return res.json({
      ...(postId && { postId }),
      ...(commentId && { commentId }),
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

module.exports = {
  toggleReaction,
  getReactionsSummary,
};
