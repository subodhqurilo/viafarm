const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Object, default: {} },
    isRead: { type: Boolean, default: false },
    userType: { type: String, default: 'Admin' }, // who should see it
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
