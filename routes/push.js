const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authMiddleware } = require('../middleware/authMiddleware');

// Save expo push token for logged in user
router.post('/', authMiddleware, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token required' });
  }

  try {
    // Save token in the user's document
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { expoPushToken: token },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Expo push token saved successfully',
      expoPushToken: user.expoPushToken
    });

  } catch (err) {
    console.error('Save token error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Remove token when user logs out
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { expoPushToken: null },
      { new: true }
    );

    res.json({ success: true, message: 'Token removed' });
  } catch (err) {
    console.error('Delete token error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
