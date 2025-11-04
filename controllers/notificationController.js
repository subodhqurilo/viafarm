// controllers/notificationController.js
const Notification = require("../models/Notification");
const { Expo } = require("expo-server-sdk");
const User = require("../models/User");

const expo = new Expo();

// ✅ Send Notification (to specific user or role)
exports.sendNotification = async (req, res) => {
  try {
    const { title, message, receiverId, userType } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    // ✅ Create and save notification in DB
    const notification = await Notification.create({
      title,
      message,
      receiverId: receiverId || null,
      userType: userType || "All", // All / Buyer / Vendor / Admin
      isRead: false,
    });

    // ✅ Push Notification logic
    let targetUsers = [];

    if (receiverId) {
      // Send to specific user
      const user = await User.findById(receiverId);
      if (user && user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
        targetUsers.push(user.expoPushToken);
      }
    } else if (userType && userType !== "All") {
      // Send to all users of a specific type (Vendor/Buyer)
      const users = await User.find({ role: userType, expoPushToken: { $exists: true } });
      targetUsers = users
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    } else {
      // Global notification
      const allUsers = await User.find({ expoPushToken: { $exists: true } });
      targetUsers = allUsers
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    }

    // ✅ Send Expo push notifications (for app users)
    if (targetUsers.length > 0) {
      const messages = targetUsers.map(pushToken => ({
        to: pushToken,
        sound: "default",
        title,
        body: message,
        data: { notificationId: notification._id },
      }));

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    }

    // ✅ If admin, send via Socket.IO (real-time)
    if (global.io) {
      if (receiverId && global.onlineUsers && global.onlineUsers[receiverId]) {
        global.io.to(global.onlineUsers[receiverId].socketId).emit("notification", notification);
      } else if (userType === "Admin" && global.onlineAdmins) {
        Object.values(global.onlineAdmins).forEach(admin => {
          global.io.to(admin.socketId).emit("notification", notification);
        });
      } else {
        global.io.emit("notification", notification);
      }
    }

    res.status(200).json({ success: true, message: "Notification sent successfully", notification });
  } catch (error) {
    console.error("Send notification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get Notifications for logged-in user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({
      $or: [
        { receiverId: userId },
        { userType: req.user.role },
        { userType: "All" },
      ],
    }).sort({ createdAt: -1 });

    res.json({ success: true, notifications });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Mark Notification as Read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findByIdAndUpdate(
      id,
      { isRead: true },
      { new: true }
    );

    if (!notification)
      return res.status(404).json({ success: false, message: "Notification not found" });

    res.json({ success: true, notification });
  } catch (err) {
    console.error("Mark as read error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Delete Single Notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndDelete({
      _id: id,
      $or: [
        { userId: req.user._id },
        { userType: req.user.role },
        { userType: "All" },
      ],
    });

    if (!notification)
      return res.status(404).json({ success: false, message: "Notification not found" });

    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Delete All Notifications
exports.deleteAllNotifications = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await Notification.deleteMany({
      $or: [
        { userId: req.user._id },
        { userType: req.user.role },
        { userType: "All" },
      ],
    });

    res.json({
      success: true,
      message: "All notifications deleted successfully",
    });
  } catch (err) {
    console.error("Delete all notifications error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

