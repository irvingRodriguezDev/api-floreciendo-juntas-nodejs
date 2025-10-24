const express = require("express");
const router = express.Router();
const AuthMiddleware = require("../middlewares/authMiddleware");

const PostCtrl = require("../controllers/CommunityPostController");
const CommentCtrl = require("../controllers/CommunityComentController");
const ReactionCtrl = require("../controllers/CommunityReactionController");
const { upload } = require("../middlewares/uploadCourseImage");

// POSTS
// En tu archivo de rutas:
router.post(
  "/posts",
  upload.single("attachment"),
  AuthMiddleware,
  PostCtrl.createPost
);
router.get("/posts/course/:courseId", PostCtrl.getPostsByCourse); // público
router.get("/posts/:id", PostCtrl.getPost);
router.put(
  "/posts/:id",
  AuthMiddleware /*, upload.array("attachments")*/,
  PostCtrl.updatePost
);
router.delete("/posts/:id", AuthMiddleware, PostCtrl.deletePost);

// COMMENTS
router.post(
  "/comments",
  AuthMiddleware /*, upload.array("attachments")*/,
  CommentCtrl.createComment
);
router.get("/comments/post/:postId", CommentCtrl.getCommentsByPost);
router.put(
  "/comments/:id",
  AuthMiddleware /*, upload.array("attachments")*/,
  CommentCtrl.updateComment
);
router.delete("/comments/:id", AuthMiddleware, CommentCtrl.deleteComment);

// REACTIONS
router.post("/reactions/toggle", AuthMiddleware, ReactionCtrl.toggleReaction);
router.get("/reactions/summary", ReactionCtrl.getReactionsSummary);
// routes/community.js
router.get(
  "/reactions/summary/multiple",
  ReactionCtrl.getReactionsSummaryMultiple
);

module.exports = router;
