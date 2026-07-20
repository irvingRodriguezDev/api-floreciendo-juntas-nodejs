const express = require("express");
const router = express.Router();
const {
  listSubscriptionsActive,
  listSubscriptionsPastDue,
} = require("../controllers/SubscriptionsController");

router.get("/active", listSubscriptionsActive);
router.get("/past-due", listSubscriptionsPastDue);

module.exports = router;
