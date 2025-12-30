const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    // ⭐ PICKUP DETAILS PER ITEM
    pickupDetails: {
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
      },
      date: String,
      startTime: String,
      endTime: String,
    },

    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    // ⭐ This field is REQUIRED for multi-vendor cart
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    }
  },
  { _id: false }
);

// ⭐ MAIN CART SCHEMA
const CartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    items: [CartItemSchema],

    // ⭐ Apply coupon to whole cart
    couponCode: {
      type: String,
    },

    // ⭐ Vendor selection (checkbox UI)
    // like: ["vendorId1", "vendorId2"]
    selectedVendors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }
    ],

    deleteAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', CartSchema);
