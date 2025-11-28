const mongoose = require("mongoose");

const deliveryPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    deliveryType: { type: String, enum: ["Pickup", "Delivery"], required: true },

    addressId: { type: mongoose.Schema.Types.ObjectId, ref: "Address", default: null },

    pickupSlot: {
      date: { type: String, default: null },
      startTime: { type: String, default: null },
      endTime: { type: String, default: null }
    },

    couponCode: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("DeliveryPreference", deliveryPreferenceSchema);
