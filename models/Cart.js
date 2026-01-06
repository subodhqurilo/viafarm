const mongoose = require('mongoose');

/* =====================================================
   🛒 CART ITEM SCHEMA
   - Supports decimal quantity (0.1, 0.5, etc.)
   - Multi-vendor safe
===================================================== */
const CartItemSchema = new mongoose.Schema(
  {
    // 🔗 Product reference
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    // ⭐ PICKUP DETAILS (PER ITEM)
    pickupDetails: {
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      date: String,
      startTime: String,
      endTime: String,
    },

    // 🔢 QUANTITY (DECIMAL ALLOWED)
    quantity: {
      type: Number,
      required: true,
      default: 0.1,
      min: 0.01, // ✅ allow decimals like 0.1, 0.25, 0.5
      set: (v) => Number(Number(v).toFixed(2)), // ✅ precision guard
      validate: {
        validator: function (v) {
          return v > 0;
        },
        message: 'Quantity must be greater than 0',
      },
    },

    // 🧑‍🌾 Vendor (REQUIRED for multi-vendor cart)
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    _id: false, // cart item doesn't need its own _id
  }
);

/* =====================================================
   🛒 MAIN CART SCHEMA
===================================================== */
const CartSchema = new mongoose.Schema(
  {
    // 👤 Cart owner
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // 1 cart per user
      index: true,
    },

    // 🧺 Cart items
    items: {
      type: [CartItemSchema],
      default: [],
    },

    // 🎟 Coupon applied on full cart
    couponCode: {
      type: String,
      trim: true,
      default: null,
    },

    // ✅ Selected vendors (checkbox logic in UI)
    selectedVendors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // 🗑 Auto-delete cart (optional cleanup)
    deleteAt: {
      type: Date,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

/* =====================================================
   📌 INDEXES
===================================================== */
CartSchema.index({ user: 1 });
CartSchema.index({ 'items.product': 1 });

/* =====================================================
   🚀 EXPORT
===================================================== */
module.exports = mongoose.model('Cart', CartSchema);
