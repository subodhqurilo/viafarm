// utils/notificationUtils.js
const Notification = require('../models/Notification');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

const createAndSendNotification = async (
  req,
  title,
  message,
  data = {},
  userType = 'Admin',
  userId = null
) => {
  try {
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');

    // ✅ Save in DB
    const notification = await Notification.create({
      title,
      message,
      data,
      userType,
      userId,
    });

    // ✅ Prepare common notification payload
    const payload = {
      id: notification._id,
      title,
      message,
      data,
      userType,
      userId,
      createdAt: notification.createdAt,
    };

    // ✅ 1️⃣ Socket.IO Notifications (for web/admin panel)
    if (userId && onlineUsers[userId]) {
      // Send to a specific user
      io.to(onlineUsers[userId].socketId).emit('notification', payload);
    } else if (userType === 'All') {
      // Send to all connected
      io.emit('notification', payload);
    } else {
      // Send to all users of a specific role
      for (const [id, info] of Object.entries(onlineUsers)) {
        if (info.role === userType) {
          io.to(info.socketId).emit('notification', payload);
        }
      }
    }

    // ✅ 2️⃣ Expo Push Notifications (for mobile apps)
    let targetUsers = [];
    if (userId) {
      const user = await User.findById(userId);
      if (user) targetUsers = [user];
    } else if (userType === 'All') {
      targetUsers = await User.find({ expoPushToken: { $exists: true } });
    } else {
      targetUsers = await User.find({ role: userType, expoPushToken: { $exists: true } });
    }

    const messages = targetUsers
      .filter(u => Expo.isExpoPushToken(u.expoPushToken))
      .map(u => ({
        to: u.expoPushToken,
        sound: 'default',
        title,
        body: message,
        data,
      }));

    if (messages.length > 0) {
      try {
        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }
        console.log(`📱 Sent Expo push to ${messages.length} device(s).`);
      } catch (expoErr) {
        console.error('❌ Expo push error:', expoErr.message);
      }
    }

    return notification;
  } catch (err) {
    console.error('❌ Notification error:', err.message);
  }
};

module.exports = { createAndSendNotification };
