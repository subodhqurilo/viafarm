const Notification = require('../models/Notification');

const createAndSendNotification = async (req, title, message, data = {}) => {
  try {
    const io = req.app.get('io');

    // Save to DB
    const notification = await Notification.create({
      title,
      message,
      data,
      userType: 'Admin',
    });

    // Emit real-time notification
    if (io) {
      io.emit('adminNotification', {
        id: notification._id,
        title,
        message,
        data,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  } catch (err) {
    console.error('Notification error:', err.message);
  }
};

module.exports = { createAndSendNotification };
