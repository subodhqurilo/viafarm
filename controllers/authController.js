// controllers/authController.js

const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');

const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const sendEmail = require('../services/emailService');

// ===== Helpers =====
// Top of authController.js
// helpers.js ya authController.js ke top me
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

        // Update basic details
        user.name = name;
        user.role = role;

        // Set password if provided
        if (password) {
            user.password = await hashPassword(password); // hash before saving
        }

        await user.save();

        const token = generateToken(user);

        res.status(200).json({
            status: 'success',
            message: 'Profile completed successfully.',
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    role: user.role,
                    mobileNumber: user.mobileNumber
                }
            }
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

        res.status(200).json({ status: 'success', message: 'OTP has been sent for login.', otp });
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

    if (!mobileNumber) {
        return res.status(400).json({ status: 'fail', message: 'Mobile number is required.' });
    }

    try {
        const user = await User.findOne({ mobileNumber });
        let otp;

        if (user) {
            // Generate OTP
            otp = otpService.generateOTP();

            // Save OTP and expiry
            user.otp = otp;
            user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
            await user.save();

            // Optional: send OTP via SMS in production
            // await smsService.sendOTP(mobileNumber, otp);
        }

        // Respond with OTP (for testing/dev purposes)
        res.status(200).json({
            status: 'success',
            message: 'If a user with that number exists, an OTP has been sent.',
            otp: otp || null // OTP only if user exists, else null
        });

    } catch (err) {
        console.error('Forgot Password Error:', err);
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

// Admin Signup (with hashed password)
exports.adminSignup = asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
        return res.status(400).json({ success: false, message: 'Admin with this email already exists.' });
    }

    const hashedPassword = await hashPassword(password);

    const newAdmin = new User({
        name,
        email,
        password: hashedPassword,
        role: 'Admin',
        isVerified: true
    });

    const createdAdmin = await newAdmin.save();

    res.status(201).json({
        success: true,
        message: 'Admin user created successfully.',
        user: {
            id: createdAdmin._id,
            name: createdAdmin.name,
            email: createdAdmin.email,
            role: createdAdmin.role
        }
    });
});

// ===== Admin Login =====
exports.adminLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });

    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Access denied. Not an admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = generateToken(user);

    res.status(200).json({
        success: true,
        message: 'Admin login successful.',
        token,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
        }
    });
});

// POST /api/auth/request-password-reset
exports.adminrequestPasswordReset = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const user = await User.findOne({ email });

    const genericMessage = 'If an account with that email exists, a password reset link has been sent.';

    if (!user) {
        return res.status(200).json({ success: true, message: genericMessage, token: null });
    }

    // Generate raw token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash it for DB
    user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour

    await user.save();
console.log("✅ Saved reset token in DB:", user.passwordResetToken);
console.log("⏳ Expires at:", user.passwordResetExpires);
    // Construct reset URL (raw token in URL)
    const resetUrl = `${req.protocol}://${req.get('host')}/api/auth/reset-password/${resetToken}`;

    const message = `
Hi ${user.name || 'User'},

You requested a password reset. Click the link below to reset your password:

${resetUrl}

If you did not request this, please ignore this email. This link will expire in 1 hour.
`;

    try {
        await sendEmail({
            email: user.email,
            subject: 'Password Reset Request',
            message
        });

        // Return token in response for testing
        res.status(200).json({
            success: true,
            message: genericMessage,
            resetToken, // <-- raw token here
            resetUrl
        });

    } catch (error) {
        // Clear token if email fails
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        res.status(500).json({ success: false, message: 'Failed to send email. Please try again later.', error: error.message });
    }
});

// POST /api/auth/reset-password/:token
exports.adminresetPassword = asyncHandler(async (req, res) => {
    const rawToken = req.params.token;
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    console.log("🔑 Raw token from URL:", rawToken);
    console.log("🔒 Hashed token from URL:", hashedToken);

    const { password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
        return res.status(400).json({ success: false, message: 'Password and confirmation are required.' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
        console.log("❌ No user found for:", hashedToken);
        return res.status(400).json({ success: false, message: 'Invalid or expired token.' });
    }

    // Hash new password
    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    res.status(200).json({
        success: true,
        message: 'Password reset successful.'
    });
});



