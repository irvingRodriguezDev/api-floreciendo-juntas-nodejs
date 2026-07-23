const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const router = express.Router();
const usrCtrl = require("../controllers/admin/UserController");
const prizeCtrl = require("../controllers/admin/MontlhyPrizeController");
router.get("/users", authMiddleware, usrCtrl.getAllUsers);
router.get("/user-eligible", authMiddleware, usrCtrl.eligibleUsers);
router.get(
  "/user-winners-current-month",
  // authMiddleware,
  usrCtrl.obtainWinnersOfMonth,
);
router.get("/run-raffle", authMiddleware, usrCtrl.runRaffleOneWinner);
router.post("/create-prize", authMiddleware, prizeCtrl.createPrize);
router.get("/montlhy-prizes", authMiddleware, prizeCtrl.getMonthlyPrizes);
router.get("/available-prizes", authMiddleware, prizeCtrl.availablePrizes);
router.delete("/delete-prize", authMiddleware, prizeCtrl.deletePrize);
module.exports = router;
