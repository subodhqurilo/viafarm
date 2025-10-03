const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  products: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
      quantity: {
        type: Number,
        required: true,
      },
      price: {
        type: Number,
        required: true,
      },
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }
    },
  ],
  totalPrice: {
    type: Number,
    required: true,
  },
  orderType: {
    type: String,
    enum: ['Delivery', 'Pickup'],
    required: true,
  },
  orderStatus: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Completed', 'Cancelled'],
    default: 'Pending',
  },
  shippingAddress: {
    type: Object, // embedded shipping address object
  },
  pickupSlot: {
    type: Date,
  },
  paymentMethod: {
    type: String,
    default: 'UPI',
  },
  transactionId: {
    type: String,
  },
  comments: {
    type: String,
  },
  donation: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
