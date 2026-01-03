const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');
const axios = require('axios');
const NotificationSettings = require('../models/NotificationSettings');

const nodemailer = require('nodemailer');

const asyncHandler = require('express-async-handler');
const crypto = require('crypto');

const Notification = require('../models/Notification');
const { createAndSendNotification } = require('../utils/notificationUtils');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const { sendEmailOTP } = require("../services/emailService");

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// 🔥 INIT RESEND (ONCE)





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
    console.log("🔐 LOGIN ATTEMPT");
    console.log("📱 Mobile Number:", mobileNumber);
    console.log("🔑 Password received:", password ? "YES" : "NO");

    // 🔍 Find user
    const user = await User.findOne({ mobileNumber });

    console.log("👤 User found:", user ? "YES" : "NO");

    if (!user) {
      console.log("❌ User NOT FOUND in DB");
      return res.status(400).json({
        status: "error",
        message: "User not found or not verified.",
      });
    }

    console.log("✅ User ID:", user._id.toString());
    console.log("✅ isVerified:", user.isVerified);
    console.log("✅ role:", user.role);

    if (!user.isVerified) {
      console.log("❌ User is NOT VERIFIED");
      return res.status(400).json({
        status: "error",
        message: "User not found or not verified.",
      });
    }

    if (!user.password) {
      console.log("❌ User has NO PASSWORD set");
      return res.status(400).json({
        status: "error",
        message: "This account has no password. Please login using OTP.",
      });
    }

    // 🔐 Compare password
    const isMatch = await user.matchPassword(password);
    console.log("🔑 Password match:", isMatch);

    if (!isMatch) {
      console.log("❌ Password INCORRECT");
      return res.status(400).json({
        status: "error",
        message: "Invalid credentials.",
      });
    }

    // 🎟️ Generate token
    const token = generateToken(user);
    console.log("✅ Token generated");

    return res.status(200).json({
      status: "success",
      message: "Login successful.",
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          role: user.role,
          mobileNumber: user.mobileNumber,
        },
      },
    });

  } catch (err) {
    console.error("🔥 LOGIN ERROR:", err);
    return res.status(500).json({
      status: "error",
      message: "Server error",
      error: err.message,
    });
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
      status: "fail",
      message: "Mobile number is required.",
    });
  }

  try {
    const user = await User.findOne({ mobileNumber });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    // 4 digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    user.otp = otp;
    user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 mins
    await user.save();

    // TODO: send SMS here

    return res.status(200).json({
      status: "success",
      message: "OTP sent successfully.",
      otp, // Dev only—remove in production
    });
    
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Server error",
      error: err.message,
    });
  }
};



exports.resetPassword = async (req, res) => {
  const { otp } = req.body;

  if (!otp) {
    return res.status(400).json({
      status: "error",
      message: "OTP is required.",
    });
  }

  try {
    const user = await User.findOne({ otp });

    if (!user || !user.otpExpiry || user.otpExpiry < Date.now()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or expired OTP.",
      });
    }

    // OTP clear
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    return res.status(200).json({
      status: "success",
      message: "OTP verified successfully.",
      mobileNumber: user.mobileNumber,   // ← IMPORTANT
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Server error",
      error: err.message,
    });
  }
};


exports.NewPassword = async (req, res) => {
  const { mobileNumber, password, confirmPassword } = req.body;

  if (!password || !confirmPassword) {
    return res.status(400).json({
      status: "error",
      message: "Password & Confirm Password are required."
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      status: "error",
      message: "Passwords do not match."
    });
  }

  try {
    const user = await User.findOne({ mobileNumber });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found."
      });
    }

    user.password = password;
    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Password updated successfully."
    });

  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Server error",
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
  console.log("🔥 adminRequestPasswordOtp HIT");
  console.log("📥 Request body:", req.body);

  const { email } = req.body;

  if (!email) {
    console.warn("⚠️ Email missing in request");
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  console.log("🔍 Finding admin with email:", email);

  const user = await User.findOne({ email, role: "Admin" });

  if (!user) {
    console.warn("❌ Admin not found for email:", email);
    return res.status(404).json({
      success: false,
      message: "Admin email not found",
    });
  }

  console.log("✅ Admin found:", user._id.toString());

  // ✅ 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  console.log("🔐 Generated OTP:", otp);

  user.passwordResetOtp = otp;
  user.passwordResetOtpExpires = Date.now() + 10 * 60 * 1000;
  user.isVerified = false;

  await user.save();
  console.log("💾 OTP saved in DB for admin");

  // 🚀 RESPONSE FIRST (Render-safe)
  res.json({
    success: true,
    message: "OTP sent to registered email",
    otp, // ⚠️ testing only — remove in production
  });

  console.log("📤 Response sent to client");

  // 🔥 SENDGRID EMAIL (BACKGROUND)
  try {
    console.log("📧 Preparing SendGrid email…");

    console.log(
      "🔑 SendGrid env check:",
      "KEY exists:", !!process.env.SENDGRID_API_KEY,
      "FROM:", process.env.SENDGRID_FROM_EMAIL
    );

    const msg = {
      to: user.email, // ✅ dynamic user email
      from: process.env.SENDGRID_FROM_EMAIL, // ✅ verified single sender
      subject: "Admin Password Reset OTP",
      html: `
        <h3>OTP Verification</h3>
        <p>Your OTP is <b>${otp}</b></p>
        <p>This OTP is valid for 10 minutes.</p>
      `,
    };

    sgMail
      .send(msg)
      .then((response) => {
        console.log("✅ OTP email sent via SendGrid");
        console.log("📨 SendGrid response status:", response[0]?.statusCode);
      })
      .catch(async (err) => {
        console.error("❌ SendGrid email failed:", err.message);

        // optional rollback
        user.passwordResetOtp = undefined;
        user.passwordResetOtpExpires = undefined;
        await user.save();
        console.log("↩️ OTP rolled back due to email failure");
      });

  } catch (err) {
    console.error("❌ SendGrid background error:", err.message);
  }
});










exports.verifyAdminPasswordOtp = asyncHandler(async (req, res) => {
  const { otp } = req.body;

  if (!otp) {
    return res.status(400).json({
      success: false,
      message: "OTP is required",
    });
  }

  const user = await User.findOne({
    role: "Admin",
    passwordResetOtp: otp,
    passwordResetOtpExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired OTP",
    });
  }

  // ✅ Mark verified (temporary session)
  user.isVerified = true;
  await user.save();

  res.json({
    success: true,
    message: "OTP verified successfully. You can now reset password.",
  });
});




// controllers/authController.js (or wherever you keep auth controllers)
exports.adminResetPasswordByOtp = asyncHandler(async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Both password fields are required",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match",
    });
  }

  const user = await User.findOne({
    role: "Admin",
    isVerified: true,
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "OTP session expired. Please verify OTP again.",
    });
  }

  // 🔐 Update password (hashed automatically)
  user.password = newPassword;

  // 🧹 Cleanup
  user.isVerified = false;
  user.passwordResetOtp = undefined;
  user.passwordResetOtpExpires = undefined;

  await user.save();

  res.json({
    success: true,
    message: "Password reset successfully",
  });
});



















