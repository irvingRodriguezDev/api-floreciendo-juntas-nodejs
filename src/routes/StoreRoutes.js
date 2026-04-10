const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const storeController = require("../controllers/StoreController");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  authMiddleware,
  upload.single("image"),
  storeController.createStore,
);
router.get("/nearby", authMiddleware, storeController.getNearbyStores);
router.get("/my-shop", authMiddleware, storeController.getMyStore);
router.patch(
  "/:id",
  authMiddleware,
  upload.single("image"),
  storeController.updateStore,
);
router.delete("/delete/:id", authMiddleware, storeController.deleteStore);

module.exports = router;
