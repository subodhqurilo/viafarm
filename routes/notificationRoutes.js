// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
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

// ✅ Delete single notification
router.delete("/:id", authMiddleware, deleteNotification);

// ✅ Delete all notifications (Clear All)
router.delete("/delete-all", authMiddleware, deleteAllNotifications);

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

module.exports = router;
