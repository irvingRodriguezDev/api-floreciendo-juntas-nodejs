const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");

const PostCtrl = require("../controllers/CommunityPostController");
const CommentCtrl = require("../controllers/CommunityComentController");
const ReactionCtrl = require("../controllers/CommunityReactionController");
const { handleUpload, upload } = require("../middlewares/uploadCourseImage");

// POSTS
// En tu archivo de rutas:
router.post(
  "/posts",
  handleUpload(upload.single("attachment")),
  authMiddleware,
  PostCtrl.createPost,
);
router.get("/posts/course/:courseId", PostCtrl.getPostsByCourse); // público
// router.get("/posts/:id", PostCtrl.getPost);
router.put(
  "/posts/:id",
  authMiddleware /*, upload.array("attachments")*/,
  PostCtrl.updatePost,
);
router.delete("/posts/:id", authMiddleware, PostCtrl.deletePost);

// COMMENTS
router.post(
  "/comments",
  authMiddleware /*, upload.array("attachments")*/,
  CommentCtrl.createComment,
);
router.get("/comments/post/:postId", CommentCtrl.getCommentsByPost);
router.put(
  "/comments/:id",
  authMiddleware /*, upload.array("attachments")*/,
  CommentCtrl.updateComment,
);
router.delete("/comments/:id", authMiddleware, CommentCtrl.deleteComment);

// REACTIONS
router.post("/reactions/toggle", authMiddleware, ReactionCtrl.toggleReaction);
router.get("/reactions/summary", ReactionCtrl.getReactionsSummary);
// routes/community.js
router.get(
  "/reactions/summary/multiple",
  ReactionCtrl.getReactionsSummaryMultiple,
);

module.exports = router;
