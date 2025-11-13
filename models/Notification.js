// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Object, default: {} },

    // ✅ Status
    isRead: { type: Boolean, default: false },

    // ✅ Notification audience type
    userType: {
      type: String,
      enum: ['Admin', 'Vendor', 'Buyer', 'All'],
      default: 'Admin',
    },

    // ✅ For personal target (null = broadcast)
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ✅ Optional: who sent this (for admin tracking)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
