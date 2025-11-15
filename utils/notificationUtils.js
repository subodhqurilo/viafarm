// utils/notificationUtils.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");


const expo = new Expo();

/**
 * createAndSendNotification()
 * Works for:
 *  ✔ Personal notifications (receiverId)
 *  ✔ Role-based notifications (userType)
 *  ✔ Broadcast (All)
 */
const createAndSendNotification = async (
  req,
  title,
  message,
  data = {},
  userType = "All",
  receiverId = null
) => {
  try {
    if (!title || !message) {
      throw new Error("Title and message are required.");
    }

    // SOCKET.IO References
    const io = req?.app?.get("io") || global.io;
    const onlineUsers = req?.app?.get("onlineUsers") || global.onlineUsers || {};

    // ========================
    // ✅ SAVE NOTIFICATION IN DB
    // ========================
    const notification = await Notification.create({
      title,
      message,
      receiverId: receiverId || null,
      userType,
      data,
      isRead: false,
      createdBy: req.user?._id || null,
    });

    const payload = {
      _id: notification._id,
      title,
      message,
      data,
      userType,
      receiverId,
      createdAt: notification.createdAt,
    };

    // ========================
    // ✅ SOCKET.IO NOTIFICATION
    // ========================
    if (io) {
      // Send to specific user if personal
      if (receiverId && onlineUsers[receiverId]) {
        io.to(onlineUsers[receiverId].socketId).emit("notification", payload);

        // Send to all for broadcast
      } else if (userType === "All") {
        io.emit("notification", payload);

        // Send to same userType
      } else if (!receiverId) {
        for (const [id, info] of Object.entries(onlineUsers)) {
          if (info.role === userType) {
            io.to(info.socketId).emit("notification", payload);
          }
        }
      }
    }

    // ========================
    // ✅ SELECT TARGET USERS FOR PUSH
    // ========================
    let users = [];

    // Personal
    if (receiverId) {
      const user = await User.findById(receiverId).select("expoPushToken");
      if (user) users = [user];

      // Broadcast
    } else if (userType === "All") {
      users = await User.find({
        expoPushToken: { $exists: true, $ne: null },
      }).select("expoPushToken");

      // Role Based
    } else {
      users = await User.find({
        role: userType,
        expoPushToken: { $exists: true, $ne: null },
      }).select("expoPushToken");
    }

    // Remove invalid/empty tokens & duplicates
    const tokens = [
      ...new Set(
        users
          .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
          .map((u) => u.expoPushToken)
      ),
    ];

    // ========================
    // ✅ BUILD PUSH MESSAGE PAYLOAD
    // ========================
    const messages = tokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body: message,
      data: {
        notificationId: notification._id,
        ...data,
      },
    }));

    let invalidTokens = [];

    // ========================
    // ✅ SEND PUSH NOTIFICATIONS
    // ========================
    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const receipts = await expo.sendPushNotificationsAsync(chunk);

          // Expo throttling safety
          await new Promise((res) => setTimeout(res, 300));

          receipts.forEach((r, index) => {
            if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
              invalidTokens.push(messages[index].to);
            }
          });
        } catch (err) {
          console.error("Expo push chunk error:", err);
        }
      }

      // ========================
      // ❌ REMOVE INVALID TOKENS
      // ========================
      if (invalidTokens.length > 0) {
        await User.updateMany(
          { expoPushToken: { $in: invalidTokens } },
          { $unset: { expoPushToken: "" } }
        );

        console.log("🗑 Removed expired Expo tokens:", invalidTokens);
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
