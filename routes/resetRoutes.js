const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const router = express.Router();

// GET - render password reset popup
router.get('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
        return res.send('<h2 style="text-align:center;color:red;">Invalid or expired link.</h2>');
    }

    res.render('reset-password', { token });
});

// POST - handle form submit
router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) return res.json({ success: false, message: 'Invalid or expired token.' });
    if (!password || !confirmPassword) return res.json({ success: false, message: 'Both fields required.' });
    if (password !== confirmPassword) return res.json({ success: false, message: 'Passwords do not match.' });

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful!' });
});

module.exports = router;
