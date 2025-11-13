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
    const io = req?.app?.get("io") || global.io;
    const onlineUsers = req?.app?.get("onlineUsers") || global.onlineUsers || {};

    if (!title || !message) throw new Error("Title and message are required.");

    // ✅ Save in DB
    const notification = await Notification.create({
      title,
      message,
      data,
      userType,
      userId,
    });

    const payload = {
      id: notification._id,
      title,
      message,
      data,
      userType,
      userId,
      createdAt: notification.createdAt,
    };

    // ✅ Socket.IO Emit
    if (io) {
      if (userId && onlineUsers[userId]) {
        io.to(onlineUsers[userId].socketId).emit("notification", payload);
      } else if (userType === "All") {
        io.emit("notification", payload);
      } else if (!userId) {
        for (const [id, info] of Object.entries(onlineUsers)) {
          if (info.role === userType) {
            io.to(info.socketId).emit("notification", payload);
          }
        }
      }
    }

    // ✅ Expo Push
    let targetUsers = [];
    if (userId) {
      const user = await User.findById(userId).select("expoPushToken");
      if (user) targetUsers = [user];
    } else if (userType === "All") {
      targetUsers = await User.find({
        expoPushToken: { $exists: true, $ne: null },
      }).select("expoPushToken");
    } else {
      targetUsers = await User.find({
        role: userType,
        expoPushToken: { $exists: true, $ne: null },
      }).select("expoPushToken");
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

    const invalidTokens = [];
    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        const receipts = await expo.sendPushNotificationsAsync(chunk);
        await new Promise((res) => setTimeout(res, 500)); // avoid throttling
        receipts.forEach((r, i) => {
          if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
            invalidTokens.push(messages[i].to);
          }
        });
      }

      if (invalidTokens.length > 0) {
        await User.updateMany(
          { expoPushToken: { $in: invalidTokens } },
          { $unset: { expoPushToken: "" } }
        );
        console.log("🗑 Removed expired Expo tokens:", invalidTokens.length);
      }

      console.log(`📱 Push sent to ${messages.length} devices.`);
    }

    return { notification, pushSent: messages.length };
  } catch (err) {
    console.error("❌ Notification error:", err);
    throw err;
  }
};

module.exports = { createAndSendNotification };
