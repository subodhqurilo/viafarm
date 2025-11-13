// routes/push.js
const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');
const { authenticate } = require('../middleware/auth');
// POST /api/push-tokens  { token, platform? }
// Upsert token; requires auth
router.post('/', authenticate, async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const doc = await PushToken.findOneAndUpdate(
      { token },
      { token, platform, userId: req.user?.id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ status: 'success', data: doc });
  } catch (err) {
    console.error('push POST error', err);
    return res.status(500).json({ error: 'server error' });
  }
});
// DELETE /api/push-tokens  { token }
// Delete token for the current user
router.delete('/', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    await PushToken.deleteOne({ token });
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('push DELETE error', err);
    return res.status(500).json({ error: 'server error' });
  }
});
module.exports = router;







