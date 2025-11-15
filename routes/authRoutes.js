const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

const {
  signup,
  verifyOtp,
  setNewPassword,
  completeProfile,
  login,
  requestOtpLogin,
  verifyOtpLogin,
  forgotPassword,
  resetPassword,
  adminLogin,
  adminSignup,
  adminRequestPasswordOtp,
  adminResetPasswordByOtp,
  logout,
} = require('../controllers/authController');

// Public Auth Routes
router.post('/signup', signup);
router.post('/verify-otp', verifyOtp);
router.post('/set-password', setNewPassword);
router.post('/login', login);
router.post('/request-otp-login', requestOtpLogin);
router.post('/verify-otp-login', verifyOtpLogin);

// Password Reset (User)
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Admin Login / Signup
router.post('/admin-login', adminLogin);
router.post('/admin-signup', adminSignup);

// Admin Password Reset via OTP
router.post('/request-password-otp', adminRequestPasswordOtp);
router.post('/reset-password-otp', adminResetPasswordByOtp);

// Reset Password Page Rendering
router.get('/reset-password/:token', (req, res) => {
  res.render('resetPassword', { token: req.params.token });
});

// Secure Routes
router.post('/complete-profile', authMiddleware, completeProfile);
router.post('/logout', authMiddleware, logout);

module.exports = router;
