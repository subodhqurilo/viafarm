// models/Donation.js
const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  message: { type: String, default: '' },
  paymentMethod: { type: String, enum: ['UPI', 'Cash'], default: 'UPI' },
  transactionRef: { type: String },
  upiUrl: { type: String },
  qrCode: { type: String },
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
}, { timestamps: true });

module.exports = mongoose.model('Donation', donationSchema);
