// utils/notificationUtils.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

const createAndSendNotification = async (
  req,
  title,
  message,
  data = {},
  userType = "Admin",
  userId = null
) => {
  try {
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // ✅ Save Notification in DB
    const notification = await Notification.create({
      title,
      message,
      data,
      userType,
      userId,
    });

    // ✅ Socket data payload
    const payload = {
      id: notification._id,
      title,
      message,
      data,
      userType,
      userId,
      createdAt: notification.createdAt,
    };

    // ✅ 1️⃣ Socket.IO (Web / Admin Dashboard)
    if (userId && onlineUsers[userId]) {
      // → Send to specific user
      io.to(onlineUsers[userId].socketId).emit("notification", payload);
    } else if (userType === "All") {
      // → Broadcast to all users
      io.emit("notification", payload);
    } else {
      // → Send to specific role (Admin / Vendor / Buyer)
      for (const [id, info] of Object.entries(onlineUsers)) {
        if (info.role === userType) {
          io.to(info.socketId).emit("notification", payload);
        }
      }
    }

    // ✅ 2️⃣ Expo Push Notifications (Mobile App)
    let targetUsers = [];

    if (userId) {
      const user = await User.findById(userId);
      if (user) targetUsers = [user];
    } else if (userType === "All") {
      targetUsers = await User.find({ expoPushToken: { $exists: true } });
    } else {
      targetUsers = await User.find({
        role: userType,
        expoPushToken: { $exists: true },
      });
    }

    const messages = targetUsers
      .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
      .map((u) => ({
        to: u.expoPushToken,
        sound: "default",
        title,
        body: message,
        data,
      }));

    // ✅ Send Push + Clean invalid tokens
    if (messages.length > 0) {
      try {
        const chunks = expo.chunkPushNotifications(messages);

        for (const chunk of chunks) {
          const receipts = await expo.sendPushNotificationsAsync(chunk);

          // 🔥 Check for expired or invalid push tokens
          for (let i = 0; i < receipts.length; i++) {
            const receipt = receipts[i];

            if (receipt.status === "error") {
              if (receipt.details?.error === "DeviceNotRegistered") {
                const invalidToken = messages[i].to;

                // 🗑 Remove expired token from DB
                await User.updateMany(
                  { expoPushToken: invalidToken },
                  { $unset: { expoPushToken: "" } }
                );

                console.log("🗑 Removed expired Expo token:", invalidToken);
              }
            }
          }
        }

        console.log(`📱 Push sent to ${messages.length} devices.`);
      } catch (err) {
        console.error("❌ Expo push send error:", err.message);
      }
    }

    return notification;
  } catch (err) {
    console.error("❌ Notification error:", err.message);
  }
};

module.exports = { createAndSendNotification };
