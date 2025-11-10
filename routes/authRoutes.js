const express = require('express');
const { authMiddleware,  } = require('../middleware/authMiddleware');

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
  adminrequestPasswordReset,
  adminresetPassword,
  logout,
} = require('../controllers/authController');

router.post('/signup', signup);
router.post('/verify-otp', verifyOtp);
router.post('/set-password', setNewPassword);
router.post('/complete-profile', completeProfile);
router.post('/login', login);
router.post('/request-otp-login', requestOtpLogin);
router.post('/verify-otp-login', verifyOtpLogin);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/admin-login', adminLogin);
router.post('/admin-signup', adminSignup);


router.post('/logout', logout);
router.get('/reset-password/:token', (req, res) => {
  res.render('resetPassword', { token: req.params.token });
});
router.post('/reset-password/:token', adminresetPassword);
router.post('/request-password-reset', adminrequestPasswordReset);

module.exports = router;
