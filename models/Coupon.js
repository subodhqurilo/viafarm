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
  appliesTo: {
    type: [String],
    enum: ['All Products', 'Fruits', 'Vegetables', 'Plants', 'Seeds', 'Handicrafts'],
    required: [true, 'Applies to field is required.'],
  },
  applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
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
    required: function() {
      // Only required if coupon is NOT for all products
      return !this.appliesTo.includes('All Products');
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);
