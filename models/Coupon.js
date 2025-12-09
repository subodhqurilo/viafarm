const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Coupon code is required.'],
    unique: true,
    trim: true,
    uppercase: true,
  },

  discount: {
    value: {
      type: Number,
      required: [true, 'Discount value is required.'],
    },
    type: {
      type: String,
      enum: ['Percentage', 'Fixed'],
      required: [true, 'Discount type is required.'],
    },
  },

  appliesTo: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category"
    }
  ],

  applicableProducts: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }
  ],

  startDate: {
    type: Date,
    required: [true, 'Start date is required.'],
  },

  expiryDate: {
    type: Date,
    required: [true, 'Expiry date is required.'],
  },

  minimumOrder: {
    type: Number,
    default: 0,
  },

  totalUsageLimit: {
    type: Number,
    default: 0,
  },

  usageLimitPerUser: {
    type: Number,
    default: 1,
  },

  usedCount: {
    type: Number,
    default: 0,
  },

  usedBy: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      count: { type: Number, default: 0 }
    }
  ],

  status: {
    type: String,
    enum: ['Active', 'Expired', 'Disabled'],
    default: 'Active',
  },

  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },

}, { timestamps: true });



/* ----------------------------------------------------
   ⭐ FIX 1 — Auto-normalize startDate & expiryDate
   Ensures:
   ✔ StartDate = 00:00:00 (full day valid)
   ✔ ExpiryDate = 23:59:59 (full day valid)
   ✔ No future-date bug
---------------------------------------------------- */
couponSchema.pre("save", function (next) {
  try {
    if (this.startDate) {
      const d = new Date(this.startDate);
      d.setHours(0, 0, 0, 0);        // start of day
      this.startDate = d;
    }

    if (this.expiryDate) {
      const d2 = new Date(this.expiryDate);
      d2.setHours(23, 59, 59, 999);  // end of day
      this.expiryDate = d2;
    }

    next();
  } catch (e) {
    next(e);
  }
});


module.exports = mongoose.model('Coupon', couponSchema);
