// controllers/notificationController.js
const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");
const { createAndSendNotification } = require("../utils/notificationUtils");

const expo = new Expo();

// ✅ Send Notification (Personal + Role + All)
exports.sendNotification = async (req, res) => {
  try {
    const { title, message, receiverId, userType, data } = req.body;

    const result = await createAndSendNotification(
      req,
      title,
      message,
      data,
      userType,
      receiverId
    );

    res.json({ success: true, notification: result.notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// =======================================
// ✅ Get Notifications (with pagination)
// =======================================
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const filter = {
      $or: [
        { receiverId: userId },
        { userType: req.user.role },
        { userType: "All" },
      ],
    };

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      ...filter,
      isRead: false,
    });

    res.json({
      success: true,
      total,
      unreadCount,
      page,
      limit,
      notifications,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// =======================================
// ✅ Mark Notification as Read
// =======================================
exports.markAsRead = async (req, res) => {
  const updated = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { new: true }
  );

  if (!updated)
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });

  res.json({ success: true, notification: updated });
};

// =======================================
// ✅ Delete Single Notification
// (supports personal + role + broadcast)
// =======================================
exports.deleteNotification = async (req, res) => {
  await Notification.findOneAndDelete({
    _id: req.params.id,
    $or: [
      { receiverId: req.user._id },
      { userType: req.user.role },
      { userType: "All" },
    ],
  });

  res.json({ success: true, message: "Notification deleted successfully" });
};

// =======================================
// ✅ Delete All Notification for current user
// =======================================
exports.deleteAllNotifications = async (req, res) => {
  await Notification.deleteMany({
    $or: [
      { receiverId: req.user._id },
      { userType: req.user.role },
      { userType: "All" },
    ],
  });

  res.json({
    success: true,
    message: "All your notifications cleared",
  });
};
