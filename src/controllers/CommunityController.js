// controllers/CommunityPostController.js
const {
  CommunityPost,
  User,
  CommunityComent,
  CommunityReaction,
} = require("../models");
// Asegúrate de que los modelos User, CommunityComent, y CommunityReaction existan e importen correctamente.

/**
 * 1. Crea una nueva publicación de foro en un curso específico.
 */
exports.createPost = async (req, res) => {
  try {
    const { courseId, content, attachments } = req.body;
    const userId = req.user ? req.user.id : 1; // ID del usuario autenticado

    if (!courseId || !content) {
      return res
        .status(400)
        .json({ error: "Faltan campos requeridos: courseId y content." });
    }

    const newPost = await CommunityPost.create({
      courseId,
      userId,
      content,
      attachments: attachments || null,
    });

    // Cargar publicación con autor
    let postWithAuthor = await CommunityPost.findByPk(newPost.id, {
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "name", "profileImage"],
        },
      ],
    });

    // Ajustar profileImage para que tenga la URL pública
    if (
      postWithAuthor &&
      postWithAuthor.author &&
      postWithAuthor.author.profileImage
    ) {
      postWithAuthor.author.profileImage = getS3Url(
        postWithAuthor.author.profileImage
      );
    }

    res.status(201).json({
      message: "Publicación de foro creada con éxito.",
      post: postWithAuthor,
    });
  } catch (error) {
    console.error("Error al crear la publicación:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor al crear la publicación." });
  }
};

/**
 * 2. Obtiene todas las publicaciones de foro para un curso específico.
 */
exports.getPostsByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const posts = await CommunityPost.findAndCountAll({
      where: { courseId },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: User,
          as: "author",
          attributes: ["id", "name", "profileImage"],
        },
        {
          model: CommunityComent,
          as: "comments",
          attributes: ["id", "content", "createdAt"],
          limit: 2,
          order: [["createdAt", "DESC"]],
        },
        {
          model: CommunityReaction,
          as: "reactions",
          attributes: ["type"],
        },
      ],
    });

    // Actualizar profileImage con URL pública
    const postsWithPublicImages = posts.rows.map((post) => {
      if (post.author && post.author.profileImage) {
        post.author.profileImage = getS3Url(post.author.profileImage);
      }
      return post;
    });

    res.status(200).json({
      totalPosts: posts.count,
      currentPage: parseInt(page),
      perPage: parseInt(limit),
      posts: postsWithPublicImages,
    });
  } catch (error) {
    console.error("Error al obtener las publicaciones:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener las publicaciones.",
    });
  }
};

/**
 * 3. Elimina una publicación de foro específica.
 */
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user ? req.user.id : 1; // Usar el ID del usuario autenticado.

    const post = await CommunityPost.findByPk(postId);

    if (!post) {
      return res
        .status(404)
        .json({ error: "Publicación de foro no encontrada." });
    }

    // Seguridad: Solo el autor puede eliminar su publicación
    if (post.userId !== userId) {
      return res
        .status(403)
        .json({ error: "No tienes permiso para eliminar esta publicación." });
    }

    await post.destroy();

    res
      .status(200)
      .json({ message: "Publicación de foro eliminada con éxito." });
  } catch (error) {
    console.error("Error al eliminar la publicación:", error);
    res.status(500).json({
      error: "Error interno del servidor al eliminar la publicación.",
    });
  }
};
