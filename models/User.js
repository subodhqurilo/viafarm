// models/User.js

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String },
  mobileNumber: {
    type: String,
    required: [true,],
    unique: true,
  },
  password: { type: String },
  role: {
    type: String,
    enum: ['buyer', 'vendor','admin'],
  },
  otp: String,
  otpExpiry: Date,
  isVerified: {
    type: Boolean,
    default: false,
  },
  profileImage: { type: String },
  email: { type: String },
  socialMedia: {
    linkedin: String,
    dribbble: String,
  },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);