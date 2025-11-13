// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const { createAndSendNotification } = require("../utils/notificationUtils");
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  sendNotification,
  getNotifications,
  markAsRead,
  deleteNotification,
  deleteAllNotifications
} = require("../controllers/notificationController");
const User = require("../models/User");

// ✅ Send new notification
router.post("/", authMiddleware, sendNotification);

// ✅ Fetch all
router.get("/", authMiddleware, getNotifications);

// ✅ Mark as read
router.put("/:id/read", authMiddleware, markAsRead);

// ✅ Delete all
router.delete("/delete-all", authMiddleware, deleteAllNotifications);

// ✅ Delete single
router.delete("/:id", authMiddleware, deleteNotification);

// ✅ Save Expo Push Token
router.put("/save-push-token", authMiddleware, async (req, res) => {
  try {
    const { expoPushToken } = req.body;
    if (!expoPushToken) return res.status(400).json({ success: false, message: "Expo push token missing" });

    // 🧠 Remove old association if token reused
    const existingUser = await User.findOne({ expoPushToken });
    if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
      await User.updateOne({ _id: existingUser._id }, { $unset: { expoPushToken: "" } });
    }

    const user = await User.findByIdAndUpdate(req.user._id, { expoPushToken }, { new: true });
    res.json({ success: true, message: "Expo push token saved", token: user.expoPushToken });
  } catch (error) {
    console.error("Expo token save error:", error);
    res.status(500).json({ success: false, message: "Failed to save expo push token" });
  }
});

// ✅ Test push route (Admin only)
router.post("/test-push", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admins only" });
    }

    const { title, message, userType = "Buyer", userId = null } = req.body;

    await createAndSendNotification(
      req,
      title || "Test Notification ✅",
      message || "This is a test push notification!",
      { from: "Postman" },
      userType,
      userId
    );

    console.log(`🔔 Test push sent: ${userType} ${userId ? "-> " + userId : "(broadcast)"}`);
    res.json({ success: true, message: "Test push sent successfully!" });
  } catch (error) {
    console.error("❌ Push test error:", error);
    res.status(500).json({ success: false, message: "Failed to send test push.", error: error.message });
  }
});

module.exports = router;
