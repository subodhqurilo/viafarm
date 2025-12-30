const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true,
  },

  variety: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: String,
    required: true,
  },
  unit: {
    type: String,
    required: true,
  },
  description: String,

  nutritionalValue: {
    servingSize: String,
    nutrients: [{
      name: String,
      amount: String
    }],
    additionalNote: String
  },

  weightPerPiece: {
    type: String,
    min: 0,
  },

  images: [{
    type: String,
    required: true,
  }],

  status: {
    type: String,
    enum: ['In Stock', 'Out of Stock'],
    default: 'In Stock',
  },

  allIndiaDelivery: {
    type: Boolean,
    default: false,
  },

  datePosted: {
    type: Date,
    default: Date.now,
  },

  rating: { type: Number, default: 5 }, // Average rating
  ratingCount: { type: Number, default: 0 },

  // ⭐ ADD THIS ⭐
  reviews: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
    }
  ],

}, { timestamps: true });

// --- TEXT INDEX ---
productSchema.index({ name: 'text', category: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);
