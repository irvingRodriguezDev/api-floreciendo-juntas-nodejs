const {
  CommunityReaction,
  CommunityPost,
  CommunityComment,
  sequelize,
} = require("../models");

const toggleReaction = async (req, res) => {
  // Expect body: { postId?, commentId?, type }
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

    // Verificar objetivo
    if (postId) {
      const post = await CommunityPost.findByPk(postId);
      if (!post) return res.status(404).json({ message: "Post no encontrado" });
    } else {
      const comment = await CommunityComment.findByPk(commentId);
      if (!comment)
        return res.status(404).json({ message: "Comentario no encontrado" });
    }

    // Checar si ya existe la reacción del mismo tipo del mismo usuario
    const where = { userId, type, postId, commentId };
    const existing = await CommunityReaction.findOne({ where });

    if (existing) {
      // Si ya existe -> eliminar (toggle off)
      await existing.destroy({ transaction: t });
      await t.commit();
      return res.json({ action: "removed", message: "Reacción removida" });
    } else {
      // Crear nueva reacción
      await CommunityReaction.create(
        { userId, postId, commentId, type },
        { transaction: t }
      );
      await t.commit();
      return res
        .status(201)
        .json({ action: "created", message: "Reacción creada" });
    }
  } catch (err) {
    await t.rollback();
    // manejo de unique constraint (por si hay carrera)
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Ya reaccionaste con ese tipo" });
    }
    console.error(err);
    return res
      .status(500)
      .json({ message: "Error al togglear reacción", error: err.message });
  }
};

const getReactionsSummaryForPost = async (req, res) => {
  try {
    const { postId } = req.params;
    if (!postId) return res.status(400).json({ message: "postId requerido" });

    const reactions = await CommunityReaction.findAll({
      where: { postId },
      attributes: [
        "type",
        [sequelize.fn("COUNT", sequelize.col("type")), "count"],
      ],
      group: ["type"],
    });

    const summary = {};
    reactions.forEach((r) => {
      summary[r.type] = parseInt(r.get("count"), 10);
    });

    return res.json({ postId, summary });
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
  getReactionsSummaryForPost,
};
