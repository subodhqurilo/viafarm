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

// ✅ Send new notification (Admin, Vendor, Buyer)
router.post("/", authMiddleware, sendNotification);

// ✅ Fetch all notifications (for logged-in user)
router.get("/", authMiddleware, getNotifications);

// ✅ Mark single notification as read
router.put("/:id/read", authMiddleware, markAsRead);
router.delete("/delete-all", authMiddleware, deleteAllNotifications);

// ✅ Delete single notification
router.delete("/:id", authMiddleware, deleteNotification);

// ✅ Delete all notifications (Clear All)


// ✅ Save Expo push token (for mobile users)
router.put("/save-push-token", authMiddleware, async (req, res) => {
  try {
    const { expoPushToken } = req.body;

    if (!expoPushToken) {
      return res
        .status(400)
        .json({ success: false, message: "Expo push token is missing" });
    }

    // ✅ Save token in user's record (only for app users)
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { expoPushToken },
      { new: true }
    );

    res.json({
      success: true,
      message: "Expo push token saved successfully",
      token: user.expoPushToken,
    });
  } catch (error) {
    console.error("Expo token save error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to save expo push token" });
  }
});


router.post("/test-push", authMiddleware, async (req, res) => {
  try {
    const { title, message, userType = "Buyer", userId = null } = req.body;

    // 🔔 Send test notification
    await createAndSendNotification(
      req,
      title || "Test Notification ✅",
      message || "This is a test Expo push notification!",
      { from: "Postman" },
      userType,
      userId
    );

    res.status(200).json({
      success: true,
      message: "Test push sent successfully!",
    });
  } catch (error) {
    console.error("❌ Push test error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send test push.",
      error: error.message,
    });
  }
});

module.exports = router;
