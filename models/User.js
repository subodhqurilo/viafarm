const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');

const userSchema = new mongoose.Schema(
  {
    name: String,

    mobileNumber: {
      type: String,
      required: function () {
        return this.role !== 'Admin';
      },
      unique: true,
      sparse: true,
    },

    email: {
      type: String,
      required: function () {
        return this.role === 'Admin';
      },
      unique: true,
      sparse: true,
    },

    password: String,

    role: {
      type: String,
      enum: ['Buyer', 'Vendor', 'Admin'],
      required: true,
    },

    profilePicture: String,
    language: { type: String, default: 'English' },

    upiId: String,

    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Blocked', 'Rejected', 'Deleted'],
      default: 'Active',
    },

    // ✅ ONLY FOR VENDOR
    vendorDetails: {
      about: { type: String, default: '' },
      location: String,          // readable address
      contactNo: String,
      totalOrders: { type: Number, default: 0 },
      farmImages: [String],
      deliveryRegion: { type: Number, default: 10 }, // km
    },

    // ✅ ONLY FOR VENDOR (GeoJSON)
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: undefined,
      },
    },

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

// ✅ Geo index ONLY works when field exists
userSchema.index({ location: '2dsphere' });


// =======================================
// ✅ Pre-save middleware (VENDOR ONLY)
// =======================================
userSchema.pre('save', async function (next) {
  try {
    // 🔥 ONLY FOR VENDOR
    if (this.role === 'Vendor') {
      const addressText = this.vendorDetails?.location;

      // Address → Coords
      if (
        addressText &&
        (!this.location?.coordinates || this.location.coordinates.length !== 2)
      ) {
        const coords = await addressToCoords(addressText);
        if (coords) {
          this.location = { type: 'Point', coordinates: coords };
        }
      }

      // Coords → Address
      else if (
        this.location?.coordinates?.length === 2 &&
        !this.vendorDetails.location
      ) {
        const [lng, lat] = this.location.coordinates;
        const addr = await coordsToAddress(lat, lng);
        if (addr?.fullAddress) {
          this.vendorDetails.location = addr.fullAddress;
        }
      }
    }

    // 🔐 Password hash
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
// ✅ Password compare
// =======================================
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
