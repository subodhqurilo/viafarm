const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discount: { type: Number, required: true },
  appliesTo: { type: String, enum: ['All Products', 'Specific Products', 'Specific Categories'], required: true },
  validTill: { type: Date, required: true },
  minimumOrder: Number,
  usageLimit: Number,
  status: { type: String, enum: ['Active', 'Expired'], default: 'Active' },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);