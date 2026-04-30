const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const storeController = require("../controllers/StoreController");
const { upload } = require("../middlewares/uploadCourseImage");
router.post(
  "/",
  upload.single("image"),
  authMiddleware,
  storeController.createStore,
);
router.get("/nearby", authMiddleware, storeController.getNearbyStores);
router.get("/my-shop", authMiddleware, storeController.getMyStore);
router.patch(
  "/:id",
  upload.single("image"),
  authMiddleware,
  storeController.updateStore,
);
router.delete("/delete/:id", authMiddleware, storeController.deleteStore);

module.exports = router;
