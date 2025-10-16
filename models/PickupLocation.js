const mongoose = require('mongoose');

const pickupLocationSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    pickupLocationText: {
        type: String,
        required: true
    },
    coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('PickupLocation', pickupLocationSchema);
