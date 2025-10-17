// routes/communityPostRoutes.js
const express = require("express");
const router = express.Router();
const communityController = require("../controllers/CommunityController");
const authMiddleware = require("../middlewares/authMiddleware");

// POST /api/v1/posts: Crear una nueva publicación (requiere autenticación)
router.post("/", authMiddleware, communityController.createPost);

// GET /api/v1/posts/course/:courseId: Obtener todas las publicaciones de un curso
router.get("/course/:courseId", communityController.getPostsByCourse);

// DELETE /api/v1/posts/:postId: Eliminar una publicación (requiere autenticación y ser el autor)
router.delete("/:postId", authMiddleware, communityController.deletePost);

module.exports = router;
