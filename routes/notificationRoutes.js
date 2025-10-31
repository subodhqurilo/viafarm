const express = require('express');
const router = express.Router();
const {
  createAndSendNotification,
  getUserNotifications,
  markAsRead,
} = require('../controllers/notificationController');

const { authMiddleware } = require('../middleware/authMiddleware');

// ✅ Create and send notification (Admin or system)
router.post('/', authMiddleware, createAndSendNotification);

// ✅ Get all notifications for logged-in user
router.get('/', authMiddleware, getUserNotifications);

// ✅ Mark as read
router.put('/:id/read', authMiddleware, markAsRead);

module.exports = router;
