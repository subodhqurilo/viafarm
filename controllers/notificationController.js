// controllers/notificationController.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// ✅ Send Notification (Personal + Role + All)
exports.sendNotification = async (req, res) => {
  try {
    const { title, message, receiverId, userType = "All", data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required",
      });
    }

    // ✅ Save Notification in DB
    const notification = await Notification.create({
      title,
      message,
      receiverId: receiverId || null,
      userType,
      data,
      isRead: false,
      createdBy: req.user?._id || null,
    });

    // ============================
    // ✅ SOCKET.IO REAL-TIME PUSH
    // ============================
    const io = global.io;
    const onlineUsers = global.onlineUsers || {};

    if (io) {
      if (receiverId && onlineUsers[receiverId]) {
        io.to(onlineUsers[receiverId].socketId).emit("notification", notification);
      } else if (userType !== "All") {
        for (const [id, info] of Object.entries(onlineUsers)) {
          if (info.role === userType) {
            io.to(info.socketId).emit("notification", notification);
          }
        }
      } else {
        io.emit("notification", notification);
      }
    }

    // ============================
    // ✅ Expo Push Notification
    // ============================

    const pushPayload = {
      notificationId: notification._id,
      ...data,
    };

    let targetUsers = [];

    // 🎯 PERSONAL NOTIFICATION
    if (receiverId) {
      const user = await User.findById(receiverId);
      if (user?.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
        targetUsers = [user.expoPushToken];
      }

      // 🎯 ROLE BASED
    } else if (userType !== "All") {
      const users = await User.find({
        role: userType,
        expoPushToken: { $exists: true, $ne: null },
      });

      targetUsers = users
        .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
        .map((u) => u.expoPushToken);

      // 🎯 BROADCAST
    } else {
      const allUsers = await User.find({
        expoPushToken: { $exists: true, $ne: null },
      });

      targetUsers = allUsers
        .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
        .map((u) => u.expoPushToken);
    }

    // Remove duplicates
    targetUsers = [...new Set(targetUsers)];

    // ============================
    // ✅ SEND PUSH NOTIFICATIONS
    // ============================
    if (targetUsers.length > 0) {
      const messages = targetUsers.map((token) => ({
        to: token,
        sound: "default",
        title,
        body: message,
        data: pushPayload,
      }));

      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          await expo.sendPushNotificationsAsync(chunk);
        } catch (err) {
          console.error("Expo push error:", err);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      notification,
    });
  } catch (error) {
    console.error("Send notification error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =======================================
// ✅ Get Notifications (with pagination)
// =======================================
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const filter = {
      $or: [
        { receiverId: userId },
        { userType: req.user.role },
        { userType: "All" },
      ],
    };

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      ...filter,
      isRead: false,
    });

    res.json({
      success: true,
      total,
      unreadCount,
      page,
      limit,
      notifications,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// =======================================
// ✅ Mark Notification as Read
// =======================================
exports.markAsRead = async (req, res) => {
  const updated = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { new: true }
  );

  if (!updated)
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });

  res.json({ success: true, notification: updated });
};

// =======================================
// ✅ Delete Single Notification
// (supports personal + role + broadcast)
// =======================================
exports.deleteNotification = async (req, res) => {
  await Notification.findOneAndDelete({
    _id: req.params.id,
    $or: [
      { receiverId: req.user._id },
      { userType: req.user.role },
      { userType: "All" },
    ],
  });

  res.json({ success: true, message: "Notification deleted successfully" });
};

// =======================================
// ✅ Delete All Notification for current user
// =======================================
exports.deleteAllNotifications = async (req, res) => {
  await Notification.deleteMany({
    $or: [
      { receiverId: req.user._id },
      { userType: req.user.role },
      { userType: "All" },
    ],
  });

  res.json({
    success: true,
    message: "All your notifications cleared",
  });
};
