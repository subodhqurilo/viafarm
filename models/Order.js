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
  enum: [
    'In-process',
    'Confirmed',
    'Out For Delivery',
    'Cancelled',
    'Ready For Pickup',
    'Completed',  ],
  default: 'In-process'
},
  shippingAddress: {
    type: Object, // embedded shipping address object
  },
  
  pickupSlot: {
  date: { type: Date, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true }
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
  qrClosed: { type: Boolean, default: false },
qrExpiry: { type: Date, default: null },

}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
