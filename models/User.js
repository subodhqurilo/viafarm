const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');

const userSchema = new mongoose.Schema(
  {
    name: { type: String },

    mobileNumber: {
      type: String,
      required: function () {
        return this.role !== 'Admin';
      },
      unique: true,
      sparse: true,
    },

    // ✅ Expo Push Token (used by notifications)
    expoPushToken: { type: String, default: null },

    email: {
      type: String,
      required: function () {
        return this.role === 'Admin';
      },
      unique: true,
      sparse: true,
    },

    password: { type: String },

    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date }, // only once

    isApproved: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },

    role: {
      type: String,
      enum: ['Buyer', 'Vendor', 'Admin'],
      required: true,
    },

    otp: { type: String },
    otpExpiry: { type: Date },

    profilePicture: { type: String },

    language: { type: String, default: 'English' },

    // Forgot password via OTP
    passwordResetOtp: { type: String },
    passwordResetOtpExpires: { type: Date },

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
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },

    upiId: { type: String },

    status: {
      type: String,
      enum: ['Active', 'Inactive', 'UnBlocked', 'Blocked', 'Rejected', 'Deleted'],
      default: 'Active',
    },

    vendorDetails: {
      about: { type: String, default: '' },
      location: String,
      contactNo: String,
      totalOrders: { type: Number, default: 0 },
      farmImages: [{ type: String }],
      deliveryRegion: { type: Number, default: 10 }, // km radius
    },

    rejectionReason: { type: String, default: null },

    // Notification preferences (LOCAL only, not Expo-based)
    notificationSettings: {
      newVendorRegistration: { type: Boolean, default: true },
      newBuyerRegistration: { type: Boolean, default: true },
      newProductRegistration: { type: Boolean, default: true },
      newOrderPlaced: { type: Boolean, default: true },
    },

    totalOrdersAsBuyer: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// =======================================
// ✅ Index for geolocation
// =======================================
userSchema.index({ location: '2dsphere' });

// =======================================
// ✅ Pre-save middleware
// =======================================
userSchema.pre('save', async function (next) {
  try {
    // 🟢 Vendors require location
    if (this.role === 'Vendor') {
      const addr =
        this.vendorDetails.location ||
        `${this.address.houseNumber || ''} ${this.address.locality || ''} ${this.address.city || ''} ${this.address.state || ''} ${this.address.pinCode || ''}`.trim();

      // 🔄 Address → Coordinates
      if (addr && (!this.location?.coordinates || this.location.coordinates[0] === 0)) {
        const coords = await addressToCoords(addr);
        if (coords) this.location = { type: 'Point', coordinates: coords };
      }

      // 🔄 Coordinates → Address
      else if (
        this.location?.coordinates &&
        (!this.vendorDetails.location || this.vendorDetails.location === '')
      ) {
        const [lng, lat] = this.location.coordinates;
        const addressData = await coordsToAddress(lat, lng);

        if (addressData && addressData.fullAddress) {
          this.vendorDetails.location = addressData.fullAddress;

          if (!this.address.city) this.address.city = addressData.city;
          if (!this.address.state) this.address.state = addressData.state;
          if (!this.address.pinCode) this.address.pinCode = addressData.pinCode;
        }
      }

      // Non-vendor cleanup
    } else {
      this.location = { type: 'Point', coordinates: [0, 0] };
    }

    // 🟢 Password hashing
    if (this.isModified('password') && this.password && !this.password.startsWith('$2b$')) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    next();
  } catch (err) {
    console.error('User pre-save error:', err);
    next(err);
  }
});

// =======================================
// ✅ Compare password
// =======================================
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// =======================================
// ⚠️ Unique mobileNumber error for Admins
// =======================================
userSchema.on('index', async function (error) {
  if (error && error.code === 11000 && error.keyPattern?.mobileNumber) {
    console.warn('Duplicate mobileNumber index error ignored for Admins.');
  }
});

module.exports = mongoose.model('User', userSchema);
