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
    type: String,
    enum: ['All Products', 'Specific Product', 'Specific Category', 'Specific Vendor'],
    required: [true, 'Applies to field is required.'],
  },
  // Store the ID of the product, category, or vendor the coupon applies to
  applicableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product' || 'Category' || 'User', // Reference based on appliesTo type
    default: null,
  },
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
  // Total usage count across all users
  totalUsageLimit: {
    type: Number,
    default: 0,
  },
  // How many times a single user can use the coupon
  usageLimitPerUser: {
    type: Number,
    default: 1,
  },
  // Keep track of how many times the coupon has been used
  usedCount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['Active', 'Expired', 'Disabled'],
    default: 'Active',
  },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);