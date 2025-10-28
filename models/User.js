const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String },

  mobileNumber: { 
    type: String, 
    required: function() { return this.role !== 'Admin'; }, 
    unique: true, 
    sparse: true // allows multiple nulls
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

  isApproved: { type: Boolean, default: false },
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
    pinCode: String,
    houseNumber: String,
    block: String,
    locality: String,
    town: String,
    district: String,
    latitude: String,
    longitude: String,
  },

  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
  },

  upiId: { type: String },
  status: { type: String, enum: ['Active', 'Inactive', 'UnBlocked','Blocked','Rejected', 'Deleted'], default: 'Active' },

  vendorDetails: {
    about: { type: String, default: '' },
    location: String,
    contactNo: String,
    totalOrders: { type: Number, default: 0 },
  
   deliveryRegion: { type: String, default: 5 }, // in km (max distance)
  },
    rejectionReason: {
        type: String,
        default: null,
    },

  notificationSettings: {
    newVendorRegistration: { type: Boolean, default: true },
    newBuyerRegistration: { type: Boolean, default: true },
    newProductRegistration: { type: Boolean, default: true },
    newOrderPlaced: { type: Boolean, default: true }
  },

  totalOrdersAsBuyer: { type: Number, default: 0 },

}, { timestamps: true });

// ✅ Create 2dsphere index for vendors
userSchema.index({ location: '2dsphere' });

// ✅ Pre-save logic
userSchema.pre('save', async function(next) {
  // Vendors must have location
  if (this.role === 'Vendor' && (!this.location || !Array.isArray(this.location.coordinates))) {
    this.location = { type: "Point", coordinates: [0, 0] };
  }

  // Admins & Buyers do not need location
  if (this.role !== 'Vendor') this.location = undefined;

  // Hash password if modified
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});

// ✅ Compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ✅ Drop mobileNumber unique index for Admins if it exists
userSchema.on('index', async function(error) {
  if (error && error.code === 11000 && error.keyPattern?.mobileNumber) {
    console.warn('Duplicate mobileNumber index error ignored for Admins.');
  }
});

module.exports = mongoose.model('User', userSchema);
