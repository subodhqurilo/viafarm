const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String },

  mobileNumber: { 
    type: String, 
    required: function() { return this.role !== 'Admin'; }, 
    unique: true, 
    sparse: true 
  },
  email: { 
    type: String, 
    required: function() { return this.role === 'Admin'; }, 
    unique: true, 
    sparse: true 
  },
  password: { type: String },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },

  isVerified: { type: Boolean, default: false },
  role: { type: String, enum: ['Buyer', 'Vendor', 'Admin'], required: true },
  otp: { type: String },
  otpExpiry: { type: Date },
  profilePicture: { type: String },
  language: { type: String, default: 'English' },

  address: {
    street: String,
    city: String,
    state: String,
    zip: String,
    pinCode: String,
    houseNumber: String,
    locality: String,
    district: String,
    latitude: String,
    longitude: String,
  },

  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number] }, // [longitude, latitude]
  },

  upiId: { type: String },
  status: { type: String, enum: ['Active', 'Inactive', 'Blocked', 'Deleted'], default: 'Active' },

  vendorDetails: {
    about: { type: String, default: '' },
    location: String,
    contactNo: String,
    totalOrders: { type: Number, default: 0 },
  },

  notificationSettings: {
    newVendorRegistration: { type: Boolean, default: true },
    newBuyerRegistration: { type: Boolean, default: true },
    newProductRegistration: { type: Boolean, default: true },
    newOrderPlaced: { type: Boolean, default: true }
  },

  totalOrdersAsBuyer: { type: Number, default: 0 },

}, { timestamps: true });

// 2dsphere index for Vendors
userSchema.index({ location: "2dsphere" });

// Pre-save hook: Fix location for non-vendors
userSchema.pre('save', function(next) {
  if (this.role !== 'Vendor') {
    this.location = undefined;
  } else {
    if (!this.location || !Array.isArray(this.location.coordinates)) {
      this.location = { type: "Point", coordinates: [0, 0] };
    }
  }
  next();
});

// ---------------------------
// Password handling
// ---------------------------

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  if (this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// Compare entered password with hashed password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
