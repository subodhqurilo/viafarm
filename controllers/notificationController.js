// controllers/notificationController.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// ✅ Send Notification (Store + Socket + Push)
exports.sendNotification = async (req, res) => {
  try {
    const { title, message, receiverId, userType = "All", data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    // ✅ Save Notification in DB
    const notification = await Notification.create({
      title,
      message,
      receiverId: receiverId || null,
      userType,
      data,
      isRead: false
    });

    // ✅ Push Notification Payload (App Tap Action ke liye important)
    const pushPayload = {
      notificationId: notification._id,
      ...data   // e.g: { type:"order", orderId:"..." }
    };

    // ✅ Select Users to Notify
    let targetUsers = [];

    if (receiverId) {
      // 🎯 Personal Notification
      const user = await User.findById(receiverId);
      if (user && user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
        targetUsers.push(user.expoPushToken);
      }
    } else if (userType !== "All") {
      // 👥 Notify All Users of a Role
      const users = await User.find({ role: userType, expoPushToken: { $exists: true } });
      targetUsers = users
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    } else {
      // 🌍 Send to Everyone
      const allUsers = await User.find({ expoPushToken: { $exists: true } });
      targetUsers = allUsers
        .filter(u => Expo.isExpoPushToken(u.expoPushToken))
        .map(u => u.expoPushToken);
    }

    // ✅ Send Expo Push Notifications
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

    // ✅ Real-time Notification (Admin Panel)
    if (global.io) {
      global.io.emit("notification", notification);
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
        { userType: "All" }
      ]
    }).sort({ createdAt: -1 });

    res.json({ success: true, notifications });

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


// ✅ Delete Single Notification
exports.deleteNotification = async (req, res) => {
  await Notification.findOneAndDelete({ _id: req.params.id });
  res.json({ success: true, message: "Notification deleted successfully" });
};


// ✅ Delete All Notifications
exports.deleteAllNotifications = async (req, res) => {
  await Notification.deleteMany({});
  res.json({ success: true, message: "All notifications cleared" });
};
