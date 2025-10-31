const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');

// ✅ Create and send notification
const createAndSendNotification = asyncHandler(async (req, res) => {
  const { title, message, userType, userId, data, relatedId, relatedModel } = req.body;
  const io = req.app.get('io');

  const notification = await Notification.create({
    title,
    message,
    userType,
    userId: userId || null,
    data: data || {},
    relatedId: relatedId || null,
    relatedModel: relatedModel || null,
  });

  // 🔥 Emit real-time notification
  if (io) {
    if (userId) {
      io.to(userId.toString()).emit('notification', notification);
    } else if (userType && userType !== 'All') {
      io.emit(`${userType.toLowerCase()}Notification`, notification);
    } else {
      io.emit('notification', notification);
    }
  }

  res.status(201).json({
    success: true,
    message: 'Notification created and sent successfully',
    data: notification,
  });
});

// ✅ Fetch notifications for a specific user
const getUserNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userType = req.user.role; // Assuming user has 'role' field

  const notifications = await Notification.find({
    $or: [
      { userId: userId },
      { userType: userType },
      { userType: 'All' },
    ],
  }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: notifications.length,
    data: notifications,
  });
});

// ✅ Mark notification as read
const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const notification = await Notification.findByIdAndUpdate(
    id,
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: 'Notification not found' });
  }

  res.status(200).json({ success: true, data: notification });
});

module.exports = {
  createAndSendNotification,
  getUserNotifications,
  markAsRead,
};
