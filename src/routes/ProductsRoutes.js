const express = require("express");
const router = express.Router();
const { upload, handleUpload } = require("../middlewares/uploadCourseImage");
const productController = require("../controllers/ProductController");
const { authMiddleware } = require("../middlewares/authMiddleware");

router.post(
  "/",
  handleUpload(upload.single("image")),
  authMiddleware,
  productController.createProduct,
);
router.get("/", productController.getAllProducts);
router.get("/:slugOrId", productController.getOneProduct);
router.put(
  "/:id",
  handleUpload(upload.single("image")),
  authMiddleware,
  productController.updateProduct,
);
router.delete("/:id", productController.deleteProduct);
module.exports = router;
