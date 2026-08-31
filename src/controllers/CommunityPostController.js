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

/**
 * CREAR PUBLICACIÓN
 * Optimizada para transacciones cortas y resiliencia de red.
 */
const createPost = async (req, res) => {
  const userId = req.user.id;
  const { courseId, content } = req.body;

  // 1. Validaciones previas (Sin tocar la DB)
  if (!courseId || !content || !content.trim()) {
    return res
      .status(400)
      .json({ message: "courseId y content son requeridos" });
  }

  let post;
  const t = await sequelize.transaction();

  try {
    // 2. Operaciones críticas (Atómicas)
    post = await CommunityPost.create(
      { courseId, userId, content },
      { transaction: t },
    );

    // Asignación de puntos dentro de la misma transacción
    await addPoints(
      userId,
      35,
      "custom",
      post.id,
      `Realizo un comentario en el curso: ${courseId}`,
      t,
    );

    // Commit inmediato para liberar la conexión al pool
    await t.commit();
  } catch (err) {
    if (t) await t.rollback();
    console.error("createPost DB Error:", err);
    return res.status(500).json({
      message: "Error al guardar en base de datos",
      error: err.message,
    });
  }

  // 3. Procesamiento post-transacción (Tareas lentas/externas)
  try {
    if (req.file) {
      const attachmentUrl = await uploadToS3("posts", req.file, post.id);
      const cleanUrl = attachmentUrl.replace(/^"|"$/g, "");
      await post.update({ attachments: cleanUrl });
    }
    console.log("Este es el post en comentarios de curso");

    // Socket fuera de la transacción para no bloquear
    const io = socketModule.getIO();
    io.emit("postCreated", post);

    // 4. Respuesta al cliente (Incluyendo autor)
    const postWithAuthor = await CommunityPost.findByPk(post.id, {
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "name", "profileImage"],
        },
      ],
    });

    // Limpieza de URLs
    if (postWithAuthor?.author?.profileImage) {
      postWithAuthor.author.profileImage = getS3Url(
        postWithAuthor.author.profileImage,
      );
    }
    if (postWithAuthor?.attachments) {
      postWithAuthor.attachments = getS3Url(
        postWithAuthor.attachments
          .replace(/\\"/g, "")
          .replace(/^"|"$/g, "")
          .replace(/^\//, ""),
      );
    }

    return res.status(201).json(postWithAuthor);
  } catch (err) {
    console.error("createPost Post-Processing Error:", err);
    // Retornamos 201 porque el post ya se creó exitosamente en el paso 2
    return res
      .status(201)
      .json({ message: "Post creado, error en adjuntos", post_id: post?.id });
  }
};

/**
 * OBTENER PUBLICACIONES POR CURSO
 * Optimizada para no saturar memoria y formatear URLs correctamente.
 */
const getPostsByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const page = Math.max(1, parseInt(req.query.page || 1));
    const limit = Math.min(50, parseInt(req.query.limit || 10)); // Capamos a 50 por seguridad
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
          limit: 5, // Solo traer los últimos 5 para aligerar la carga
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
      const data = p.toJSON();

      // Resumen de reacciones eficiente
      const reactions = data.reactions || [];
      data.reactionsSummary = reactions.reduce(
        (acc, r) => {
          acc.total += 1;
          acc.byType[r.type] = (acc.byType[r.type] || 0) + 1;
          return acc;
        },
        { total: 0, byType: {} },
      );
      delete data.reactions;

      // Formateo de URLs S3
      if (data.author?.profileImage)
        data.author.profileImage = getS3Url(data.author.profileImage);
      if (data.attachments)
        data.attachments = getS3Url(
          data.attachments.replace(/^"|"$/g, "").replace(/^\/+/, ""),
        );

      data.comments = data.comments.map((c) => {
        if (c.user?.profileImage)
          c.user.profileImage = getS3Url(c.user.profileImage);
        return c;
      });

      return data;
    });

    return res.json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      posts,
    });
  } catch (error) {
    console.error("getPostsByCourse Error:", error);
    return res
      .status(500)
      .json({ message: "Error interno", error: error.message });
  }
};

/**
 * ACTUALIZAR PUBLICACIÓN
 */
const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const post = await CommunityPost.findByPk(id);
    if (!post) return res.status(404).json({ message: "Post no encontrado" });
    if (post.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    // Actualización directa (Sin transacción si es un solo update, Sequelize lo hace atómico)
    await post.update({
      content: content ?? post.content,
    });

    return res.json(post);
  } catch (err) {
    console.error("updatePost Error:", err);
    return res
      .status(500)
      .json({ message: "Error al actualizar", error: err.message });
  }
};

/**
 * ELIMINAR PUBLICACIÓN
 */
const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await CommunityPost.findByPk(id);
    if (!post) return res.status(404).json({ message: "Post no encontrado" });
    if (post.userId !== userId)
      return res.status(403).json({ message: "No autorizado" });

    await post.destroy();
    return res.json({ message: "Post eliminado con éxito" });
  } catch (err) {
    console.error("deletePost Error:", err);
    return res
      .status(500)
      .json({ message: "Error al eliminar", error: err.message });
  }
};

module.exports = {
  createPost,
  getPostsByCourse,
  updatePost, // Añadí el export que faltaba
  deletePost,
};
