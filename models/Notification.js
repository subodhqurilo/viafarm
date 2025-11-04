// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Object, default: {} },
    isRead: { type: Boolean, default: false },
    userType: { type: String, enum: ['Admin', 'Vendor', 'Buyer', 'All'], default: 'Admin' }, // ✅ Added "All"
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // ✅ For personal target
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
