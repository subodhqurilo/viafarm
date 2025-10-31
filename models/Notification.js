const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: Object,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
    },

    // 🧠 To know who should get the notification
    userType: {
      type: String,
      enum: ['Admin', 'Vendor', 'Buyer', 'All'],
      default: 'All',
    },

    // 👤 For user-specific notifications (e.g. one vendor, one buyer)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // 📦 Optional: for extra context (like order or product)
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    relatedModel: {
      type: String,
      default: null, // e.g. 'Order', 'Product'
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
