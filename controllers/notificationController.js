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
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    // ✅ Save in DB
    const notification = await Notification.create({
      title,
      message,
      receiverId: receiverId || null,
      userType,
      data,
      isRead: false,
      createdBy: req.user?._id || null,
    });

    // ✅ Socket.IO Real-time Send
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

    // ✅ Push Notification Payload
    const pushPayload = {
      notificationId: notification._id,
      ...data
    };

    // ✅ Select Target Users
    let targetUsers = [];
    if (receiverId) {
      const user = await User.findById(receiverId);
      if (user && user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
        targetUsers = [user.expoPushToken];
      }
    } else if (userType !== "All") {
      const users = await User.find({
        role: userType,
        expoPushToken: { $exists: true, $ne: null }
      });
      targetUsers = users
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    } else {
      const allUsers = await User.find({
        expoPushToken: { $exists: true, $ne: null }
      });
      targetUsers = allUsers
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    }

    // ✅ Send Expo Push
    if (targetUsers.length > 0) {
      const messages = targetUsers.map(token => ({
        to: token,
        sound: "default",
        title,
        body: message,
        data: pushPayload,
      }));

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    }

    res.status(200).json({ success: true, message: "Notification sent successfully", notification });
  } catch (error) {
    console.error("Send notification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get Notifications (with pagination + unread count)
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const filter = {
      $or: [
        { receiverId: userId },
        { userType: req.user.role },
        { userType: "All" }
      ]
    };

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ ...filter, isRead: false });

    res.json({ success: true, total, unreadCount, page, limit, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Mark as Read
exports.markAsRead = async (req, res) => {
  const updated = await Notification.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true });
  if (!updated) return res.status(404).json({ success: false, message: "Notification not found" });
  res.json({ success: true, notification: updated });
};

// ✅ Delete Single
exports.deleteNotification = async (req, res) => {
  try {
    const id = req.params.id;

    // Validate MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const deleted = await Notification.findOneAndDelete({
      _id: id,
      receiverId: req.user._id,
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    res.json({
      success: true,
      message: "Notification deleted successfully",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// ✅ Delete All (only for current user)
exports.deleteAllNotifications = async (req, res) => {
  await Notification.deleteMany({
    $or: [{ receiverId: req.user._id }, { userType: req.user.role }]
  });
  res.json({ success: true, message: "All your notifications cleared" });
};
