const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/signup', authController.signup);
router.post('/verify-otp', authController.verifyOtp);
router.post('/set-password', authController.setNewPassword);
router.post('/complete-profile', authController.completeProfile);
router.post('/login', authController.login);
router.post('/request-otp-login', authController.requestOtpLogin);
router.post('/verify-otp-login', authController.verifyOtpLogin);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
