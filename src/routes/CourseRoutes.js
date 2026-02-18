const authMiddleware = require("../middlewares/authMiddleware");
const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/uploadCourseImage");
const courseController = require("../controllers/CourseController");

// ✅ Rutas correctas
router.post(
  "/",
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
    { name: "workbook", maxCount: 1 },
  ]),
  courseController.createCourse,
);
router.get("/", courseController.getCourses);
router.get("/download-certificate", courseController.downloadCertificate);
router.get("/lastAdded", courseController.getNewCourses);
router.get("/paginate", courseController.getCoursesPaginate);
router.get("/bySystem", courseController.getCoursesBySystem);
router.get("/top-viewed-courses", courseController.getTopViewedCourses);
router.get("/:id", courseController.getCourseById);
router.put(
  "/:id",
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  courseController.updateCourse,
);
router.delete("/:id", courseController.deleteCourse);

module.exports = router;
