const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken'); // ensure model exists
const { authenticate } = require('../middleware/auth'); // if you have it
router.post('/', authenticate, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const doc = await PushToken.findOneAndUpdate(
      { token },
      { token, platform, userId: req.user?.id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ status: 'success', data: doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});
router.delete('/', authenticate, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  await PushToken.deleteOne({ token });
  res.json({ status: 'success' });
});
module.exports = router;
