const Notification = require('../models/Notification');

const createAndSendNotification = async (req, title, message, data = {}, userType = 'All', userId = null) => {
  try {
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');

    // 🟢 Save notification in DB
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

    // 🟢 Send to specific user if online
    if (userId && onlineUsers[userId]) {
      io.to(onlineUsers[userId].socketId).emit('notification', payload);
      console.log(`📨 Sent to ${onlineUsers[userId].role}: ${userId}`);
    }
    // 🟢 Or broadcast to all users of that type
    else if (userType !== 'All') {
      Object.entries(onlineUsers).forEach(([id, info]) => {
        if (info.role === userType) {
          io.to(info.socketId).emit('notification', payload);
        }
      });
      console.log(`📡 Broadcasted to all ${userType}s`);
    }
    // 🟢 Send to everyone
    else {
      io.emit('notification', payload);
      console.log('🌍 Broadcasted to all users');
    }

    return notification;
  } catch (err) {
    console.error('❌ Notification error:', err.message);
  }
};

module.exports = { createAndSendNotification };
