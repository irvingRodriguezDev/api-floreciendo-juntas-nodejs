const express = require("express");
const router = express.Router();
const postController = require("../controllers/PostController");
const authMiddleware = require("../middlewares/authMiddleware");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  authMiddleware,
  upload.array("files", 6),
  postController.createPost
);
router.get("/", postController.getFeed);
router.post(
  "/:id/comments",
  authMiddleware,
  upload.array("files", 4),
  postController.addComment
);

module.exports = router;
