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
 *  ✔ Follows user notification settings 🔥
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

    const io = req?.app?.get("io") || global.io;
    const onlineUsers = req?.app?.get("onlineUsers") || global.onlineUsers || {};

    // ================================================================
    // 🔍 PERSONAL NOTIFICATION — FIRST CHECK USER SETTINGS
    // ================================================================
    if (receiverId) {
      const targetUser = await User.findById(receiverId).select(
        "notificationSettings role"
      );

      if (targetUser) {
        const s = targetUser.notificationSettings;
        let allowed = true;

        if (userType === "Buyer" && !s.newBuyerRegistration) allowed = false;
        if (userType === "Vendor" && !s.newVendorRegistration) allowed = false;
        if (userType === "Admin" && !s.newProductRegistration) allowed = false;

        if (data?.orderId && !s.newOrderPlaced) allowed = false;

        if (!allowed) {
          console.log("🚫 Notification blocked by settings:", receiverId);
          return { notification: null, pushSent: 0 };
        }
      }
    }

    // ================================================================
    // ✅ SAVE NOTIFICATION IN DB
    // ================================================================
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

    // ================================================================
    // ✅ SEND REAL-TIME VIA SOCKET.IO
    // ================================================================
    if (io) {
      if (receiverId && onlineUsers[receiverId]) {
        io.to(onlineUsers[receiverId].socketId).emit("notification", payload);
      } else if (userType === "All") {
        io.emit("notification", payload);
      } else if (!receiverId) {
        for (const [id, info] of Object.entries(onlineUsers)) {
          if (info.role === userType) {
            io.to(info.socketId).emit("notification", payload);
          }
        }
      }
    }

    // ================================================================
    // 🔥 COLLECT TARGET USERS FOR PUSH NOTIFICATION
    // ================================================================
    let users = [];

    if (receiverId) {
      users = await User.find({ _id: receiverId }).select(
        "expoPushToken notificationSettings role"
      );
    } else if (userType === "All") {
      users = await User.find({
        expoPushToken: { $exists: true, $ne: null }
      }).select("expoPushToken notificationSettings role");
    } else {
      users = await User.find({
        role: userType,
        expoPushToken: { $exists: true, $ne: null }
      }).select("expoPushToken notificationSettings role");
    }

    // ================================================================
    // 🔍 FILTER USERS BASED ON THEIR NOTIFICATION SETTINGS
    // ================================================================
    users = users.filter((u) => {
      const s = u.notificationSettings;

      if (userType === "Buyer" && !s.newBuyerRegistration) return false;
      if (userType === "Vendor" && !s.newVendorRegistration) return false;
      if (userType === "Admin" && !s.newProductRegistration) return false;

      if (data?.orderId && !s.newOrderPlaced) return false;

      return true;
    });

    // ================================================================
    // 🎯 CLEAN TOKEN LIST
    // ================================================================
    const tokens = [
      ...new Set(
        users
          .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
          .map((u) => u.expoPushToken)
      ),
    ];

    // ================================================================
    // 🎁 BUILD PUSH PAYLOAD
    // ================================================================
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

    // ================================================================
    // 🚀 SEND PUSH NOTIFICATIONS
    // ================================================================
    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const receipts = await expo.sendPushNotificationsAsync(chunk);
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

      if (invalidTokens.length > 0) {
        await User.updateMany(
          { expoPushToken: { $in: invalidTokens } },
          { $unset: { expoPushToken: "" } }
        );

        console.log("🗑 Removed invalid Expo tokens:", invalidTokens);
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
