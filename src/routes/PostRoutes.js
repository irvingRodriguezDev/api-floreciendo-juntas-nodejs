const express = require("express");
const router = express.Router();
const postController = require("../controllers/PostController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  authMiddleware,
  upload.array("files", 6),
  postController.createPost,
);
router.get("/", authMiddleware, postController.getFeed);
router.post(
  "/:id/comments",
  authMiddleware,
  upload.array("files", 4),
  postController.addComment,
);
router.post("/:id/reaction", authMiddleware, postController.toggleLike);
router.post(
  "/comments/:commentId/reaction",
  authMiddleware,
  postController.toggleCommentLike,
);
router.get("/:postId/show", authMiddleware, postController.ShowOnePostById);
module.exports = router;
