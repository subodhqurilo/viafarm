const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');
const axios = require('axios');
const NotificationSettings = require('../models/NotificationSettings');


const asyncHandler = require('express-async-handler');
const crypto = require('crypto');

const Notification = require('../models/Notification');
const { createAndSendNotification } = require('../utils/notificationUtils');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const { sendEmailOTP } = require("../services/emailService");




const generateToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15d' });



const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};


// --- Socket notification helper ---
const sendAdminNotification = (req, message, data = {}) => {
  const io = req.app.get('io');
  if (io) {
    io.emit('adminNotification', { message, data, time: new Date() });
  }
};



exports.signup = asyncHandler(async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ status: 'error', message: 'Mobile number is required.' });
  }

  let user = await User.findOne({ mobileNumber });

  if (user && user.isVerified) {
    return res.status(400).json({ status: 'error', message: 'This mobile number is already registered.' });
  }

  // Generate OTP and expiry
  const otp = otpService.generateOTP();
  const otpExpiry = Date.now() + (process.env.OTP_EXPIRY_MINUTES || 5) * 60 * 1000; // 5 minutes

  if (user) {
    user.otp = otp;
    user.otpExpiry = otpExpiry;
  } else {
    user = new User({
      mobileNumber,
      otp,
      otpExpiry,
      isVerified: false,
      role: 'Buyer', // default role
    });
  }

  await user.save();

  // Send OTP via SMS
  const otpSent = await otpService.sendOTP(mobileNumber, otp);
  if (!otpSent) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send OTP. Please try again.'
    });
  }

  res.status(201).json({
    status: 'success',
    message: 'OTP has been sent to your mobile number.',
    otp // uncomment for testing only
  });
});



exports.verifyOtp = asyncHandler(async (req, res) => {
  const { mobileNumber, otp } = req.body;

  if (!mobileNumber || !otp) {
    return res.status(400).json({ status: 'error', message: 'Mobile number and OTP are required.' });
  }

  try {
    const user = await User.findOne({ mobileNumber });

    if (!user || !user.otp || user.otp !== otp) {
      return res.status(400).json({ status: 'error', message: 'Invalid OTP.' });
    }

    if (!user.otpExpiry || user.otpExpiry < Date.now()) {
      return res.status(400).json({ status: 'error', message: 'OTP has expired. Please request a new one.' });
    }

    // Mark user as verified
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;

    await user.save();

    // Optional: generate JWT for immediate login
    // const token = generateToken(user);

    res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully. Please complete your profile.'
      // token // uncomment if sending JWT immediately
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
  }
});



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

    // ✅ Directly assign password, pre-save hook will hash it
    user.password = password;

    await user.save();

    res.status(200).json({ status: 'success', message: 'Password has been set successfully.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
  }
};



exports.completeProfile = async (req, res) => {
  const { mobileNumber, name, password, role } = req.body;

  try {
    // 1️⃣ Verify user by mobileNumber only
    const user = await User.findOne({ mobileNumber, isVerified: true });

    if (!user) {
      return res.status(400).json({
        status: "error",
        message: "User not verified or not found.",
      });
    }

    // 2️⃣ Update profile fields
    user.name = name;
    user.role = role;

    if (password) {
      user.password = password; // auto-hashed by model hooks
    }

    await user.save();

    // ❌ NO TOKEN REQUIRED — as per your request
    // const token = generateToken(user);

    // 3️⃣ Send Notification to User
    await createAndSendNotification(
      req,
      "Profile Completed 🎉",
      `Hi ${user.name}, your ${user.role} profile has been completed successfully.`,
      {
        action: "profile_completed",
        userId: user._id,
        role: user.role,
      },
      user.role,
      user._id
    );

    // 4️⃣ Send Notification to Admin(s)
    let adminTitle = "User Profile Completed";
    let adminMessage = `${user.name} has completed their profile.`;

    if (user.role === "Buyer") {
      adminTitle = "New Buyer Registered 🛍️";
      adminMessage = `Buyer "${user.name}" has completed registration.`;
    } 
    else if (user.role === "Vendor") {
      adminTitle = "New Vendor Registered 🏪";
      adminMessage = `Vendor "${user.name}" has completed registration.`;
    }

    await createAndSendNotification(
      req,
      adminTitle,
      adminMessage,
      {
        action: "user_profile_completed",
        userId: user._id,
        role: user.role,
      },
      "Admin"
    );

    // RESPONSE WITHOUT TOKEN
    res.status(200).json({
      status: "success",
      message: "Profile completed successfully.",
      data: {
        user: {
          id: user._id,
          name: user.name,
          role: user.role,
          mobileNumber: user.mobileNumber,
        },
      },
    });

  } catch (err) {
    console.error("❌ completeProfile error:", err);
    res.status(500).json({
      status: "error",
      message: "Server error while completing profile.",
      error: err.message,
    });
  }
};





exports.login = async (req, res) => {
  const { mobileNumber, password } = req.body;

  try {

    const user = await User.findOne({ mobileNumber });


    if (!user || !user.isVerified) {
      return res.status(400).json({ status: 'error', message: 'User not found or not verified.' });
    }

    if (!user.password) {
      return res.status(400).json({
        status: 'error',
        message: 'This account has no password. Please login using OTP.',
      });
    }

    // Use schema method to compare
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(400).json({ status: 'error', message: 'Invalid credentials.' });
    }

    const token = generateToken(user);

    res.status(200).json({
      status: 'success',
      message: 'Login successful.',
      data: { token, user: { id: user._id, name: user.name, role: user.role, mobileNumber: user.mobileNumber } }
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
  }
};



exports.requestOtpLogin = asyncHandler(async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ status: 'error', message: 'Mobile number is required.' });
  }

  try {
    const user = await User.findOne({ mobileNumber });

    if (!user || !user.isVerified) {
      return res.status(400).json({ status: 'error', message: 'User not found or not verified.' });
    }

    // Generate OTP
    const otp = otpService.generateOTP();
    const otpExpiry = Date.now() + (process.env.OTP_EXPIRY_MINUTES || 5) * 60 * 1000; // 5 min expiry

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP via SMS
    const sent = await otpService.sendOTP(mobileNumber, otp);
    if (!sent) {
      return res.status(500).json({ status: 'error', message: 'Failed to send OTP. Please try again.' });
    }

    res.status(200).json({
      status: 'success',
      message: 'OTP has been sent for login.',
      otp // remove in production
    });

  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Server error', error: err.message });
  }
});


exports.verifyOtpLogin = asyncHandler(async (req, res) => {
  const { mobileNumber, otp } = req.body;

  if (!mobileNumber || !otp) {
    return res.status(400).json({ status: 'error', message: 'Mobile number and OTP are required.' });
  }

  try {
    // Find user by mobile number
    const user = await User.findOne({ mobileNumber });

    // Check if OTP matches and is not expired
    if (!user || !user.otp || user.otp !== otp || !user.otpExpiry || user.otpExpiry < Date.now()) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP.' });
    }

    // Generate JWT token
    const token = generateToken(user);

    // Clear OTP fields after successful login
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Login successful.',
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
});



exports.forgotPassword = async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({
      status: 'fail',
      message: 'Mobile number is required.',
    });
  }

  try {
    const user = await User.findOne({ mobileNumber });
    let otp = null;

    if (user) {
      // Generate new OTP
      otp = otpService.generateOTP();

      // Save OTP + expiry (10 minutes)
      user.otp = otp;
      user.otpExpiry = Date.now() + 10 * 60 * 1000;
      await user.save();

      // Optional: send OTP via SMS in production
      // await smsService.sendOTP(mobileNumber, otp);

    }

    res.status(200).json({
      status: 'success',
      message:
        'If an account with that number exists, an OTP has been sent.',
      otp, // always include for dev/testing
    });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: err.message,
    });
  }
};


exports.resetPassword = async (req, res) => {
  const { otp, newPassword, confirmPassword } = req.body;

  if (!otp || !newPassword || !confirmPassword) {
    return res.status(400).json({ status: 'error', message: 'All fields are required.' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ status: 'error', message: 'Passwords do not match.' });
  }

  try {
    // ✅ Find user by OTP only
    const user = await User.findOne({ otp });

    if (!user || !user.otpExpiry || user.otpExpiry < Date.now()) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP.' });
    }

    // ✅ Update password
    user.password = newPassword;

    // ✅ Clear OTP fields
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Password has been reset successfully.'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: err.message
    });
  }
};



exports.adminSignup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });

  const userExists = await User.findOne({ email });
  if (userExists)
    return res.status(400).json({ success: false, message: 'Admin with this email already exists.' });

  const newAdmin = new User({
    name,
    email,
    password, // plain password
    role: 'Admin',
    isVerified: true,
    isApproved: true
  });

  const createdAdmin = await newAdmin.save();
  const token = generateToken(createdAdmin);

  res.status(201).json({
    success: true,
    message: 'Admin user created successfully.',
    token,
    user: {
      id: createdAdmin._id,
      name: createdAdmin.name,
      email: createdAdmin.email,
      role: createdAdmin.role
    }
  });
});


exports.adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  const user = await User.findOne({ email });
  if (!user)
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  if (user.role !== 'Admin')
    return res.status(403).json({ success: false, message: 'Access denied. Not an admin.' });
  // Compare password using bcrypt
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch)
    return res.status(401).json({ success: false, message: 'Invalid password' });
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



exports.logout = asyncHandler(async (req, res) => {
  // In a real application, advanced security might involve token blacklisting (using Redis or a similar store)
  // to instantly invalidate the JWT on the server side. For a standard API, this confirmation is sufficient.
  res.json({
    success: true,
    message: 'Logged out successfully.'
  });
});







exports.adminRequestPasswordOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email)
    return res.status(400).json({ success: false, message: "Email is required." });

  const user = await User.findOne({ email, role: "Admin" });
  const genericMsg = "If an admin account with that email exists, an OTP has been sent.";

  if (!user)
    return res.status(200).json({ success: true, message: genericMsg });

  // 🔢 Generate 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  user.passwordResetOtp = otp;
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save();

  try {
    // ✅ Send OTP email using Resend API function
    const sent = await sendEmailOTP(user.email, otp);

    if (!sent) {
      throw new Error("Email send failed");
    }

    // ✅ Include OTP in response for testing only
    res.status(200).json({
      success: true,
      message: "OTP sent to your email address.",
      otp,
      expiresIn: "10 minutes",
    });

  } catch (err) {
    // rollback fields
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    console.error("❌ Failed to send OTP email:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP email.",
      error: err.message,
    });
  }
});




// controllers/authController.js (or wherever you keep auth controllers)
exports.adminResetPasswordByOtp = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;

  // --- Validate inputs ---
  if (!email || !otp || !password) {
    return res.status(400).json({
      success: false,
      message: "Email, OTP, and password are required.",
    });
  }

  // --- Find admin user by email ---
  const user = await User.findOne({ email, role: "Admin" });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Admin not found with this email.",
    });
  }

  // --- Verify OTP ---
  if (user.passwordResetOtp !== otp) {
    return res.status(400).json({
      success: false,
      message: "Invalid OTP.",
    });
  }

  // --- Check expiry ---
  if (!user.passwordResetExpires || user.passwordResetExpires < Date.now()) {
    // cleanup expired fields
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;
    await user.save().catch(() => {});
    return res.status(400).json({
      success: false,
      message: "OTP expired. Please request a new one.",
    });
  }

  // --- Update password (hash via pre-save hook) ---
  user.password = password;
  user.passwordResetOtp = undefined;
  user.passwordResetExpires = undefined;

  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password has been reset successfully.",
    email: user.email, // optional: include for clarity
  });
});


















