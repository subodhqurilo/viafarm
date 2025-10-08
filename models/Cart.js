const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    pickupDetails: {
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  date: String,
  startTime: String,
  endTime: String,
},

    quantity: {
        type: Number,
        required: true,
        default: 1,
        min: 1
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true, // Track vendor for multi-vendor checkout
    }
}, { _id: false });

const CartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [CartItemSchema],
    couponCode: {
        type: String, // Code applied to the cart
    },
}, { timestamps: true });

module.exports = mongoose.model('Cart', CartSchema);
