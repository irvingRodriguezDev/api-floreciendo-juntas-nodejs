const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/uploadCourseImage");
const courseController = require("../controllers/CourseController");

// ✅ Rutas correctas
router.post("/", upload.single("coverImage"), courseController.createCourse);
router.get("/", courseController.getCourses);
router.get("/:id", courseController.getCourseById);
router.put("/:id", upload.single("coverImage"), courseController.updateCourse);
router.delete("/:id", courseController.deleteCourse);

module.exports = router;
