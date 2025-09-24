// controllers/authController.js

const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');

// ===== Helpers =====
const generateToken = (user) =>
    jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15d' });

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

// ===== Signup (Create Account) =====
exports.signup = async (req, res) => {
    const { mobileNumber } = req.body;
    try {
        let user = await User.findOne({ mobileNumber });

        if (user && user.isVerified) {
            return res.status(400).json({ status: 'error', message: 'This mobile number is already registered.' });
        }

        const otp = otpService.generateOTP();
        const otpExpiry = Date.now() + 10 * 60 * 1000;

        if (user) {
            user.otp = otp;
            user.otpExpiry = otpExpiry;
        } else {
            user = new User({ mobileNumber, otp, otpExpiry, isVerified: false });
        }

        await user.save();

        res.status(201).json({ 
  status: 'success', 
  message: 'OTP has been sent to your mobile number.', 
  otp 
});

    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Verify OTP (Signup flow) =====
exports.verifyOtp = async (req, res) => {
    const { mobileNumber, otp } = req.body;
    try {
        const user = await User.findOne({ mobileNumber, otp });

        if (!user || !user.otpExpiry || user.otpExpiry < Date.now()) {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP.' });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();

        res.status(200).json({ status: 'success', message: 'OTP verified. Please complete your profile.' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Set New Password (after verification) =====
exports.setNewPassword = async (req, res) => {
    const { mobileNumber, password, confirmPassword } = req.body;
    try {
        if (password !== confirmPassword) {
            return res.status(400).json({ status: 'error', message: 'Passwords do not match.' });
        }

        const user = await User.findOne({ mobileNumber });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found.' });
        }

        user.password = await hashPassword(password);
        await user.save();

        res.status(200).json({ status: 'success', message: 'Password has been set successfully.' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Complete Profile (name, password, role) =====
exports.completeProfile = async (req, res) => {
    const { mobileNumber, name, password, role } = req.body;

    try {
        const user = await User.findOne({ mobileNumber, isVerified: true });
        if (!user) {
            return res.status(400).json({ status: 'error', message: 'User not verified or not found.' });
        }

        user.name = name;
        user.role = role;
        await user.save();

        const token = generateToken(user);

        res.status(200).json({
            status: 'success',
            message: 'Profile completed successfully.',
            data: { token, user: { id: user._id, name: user.name, role: user.role } }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Login with Password =====
exports.login = async (req, res) => {
    const { mobileNumber, password } = req.body;
    try {
        const user = await User.findOne({ mobileNumber });
        if (!user || !user.isVerified) {
            return res.status(400).json({ status: 'error', message: 'User not found or not verified.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ status: 'error', message: 'Invalid credentials.' });

        const token = generateToken(user);

        res.status(200).json({
            status: 'success',
            message: 'Login successful.',
            data: { token, user: { id: user._id, name: user.name, role: user.role } }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Request OTP for Login =====
exports.requestOtpLogin = async (req, res) => {
    const { mobileNumber } = req.body;
    try {
        const user = await User.findOne({ mobileNumber });
        if (!user || !user.isVerified) {
            return res.status(400).json({ status: 'error', message: 'User not found or not verified.' });
        }

        const otp = otpService.generateOTP();
        user.otp = otp;
        user.otpExpiry = Date.now() + 10 * 60 * 1000;
        await user.save();

        res.status(200).json({ status: 'success', message: 'OTP has been sent for login.' ,otp});
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Verify OTP Login =====
exports.verifyOtpLogin = async (req, res) => {
    const { mobileNumber, otp } = req.body;
    try {
        const user = await User.findOne({ mobileNumber, otp });
        if (!user || !user.otpExpiry || user.otpExpiry < Date.now()) {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP.' });
        }

        const token = generateToken(user);

        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();

        res.status(200).json({
            status: 'success',
            message: 'Login successful.',
            data: { token, user: { id: user._id, name: user.name, role: user.role } }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};

// ===== Forgot Password (send OTP) =====
exports.forgotPassword = async (req, res) => {
    const { mobileNumber } = req.body;

    try {
        const user = await User.findOne({ mobileNumber });
        let otp;

        if (user) {
            otp = otpService.generateOTP();
            user.otp = otp;
            user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
            await user.save();
        }

        res.status(200).json({
            status: 'success',
            message: 'If a user with that number exists, an OTP has been sent.',
            otp: otp || null // include OTP only if user exists
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};


// ===== Reset Password (verify OTP + set new password) =====
exports.resetPassword = async (req, res) => {
    const { mobileNumber, otp, newPassword, confirmPassword } = req.body;
    try {
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ status: 'error', message: 'Passwords do not match.' });
        }

        const user = await User.findOne({ mobileNumber, otp });
        if (!user || !user.otpExpiry || user.otpExpiry < Date.now()) {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP.' });
        }

        user.password = await hashPassword(newPassword);
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();

        res.status(200).json({ status: 'success', message: 'Password has been reset successfully.' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
    }
};