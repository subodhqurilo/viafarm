const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    name: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    pinCode: { type: String, required: true },
    houseNumber: { type: String, required: true },
    locality: { type: String, required: true },
    city: { type: String, required: true },
    district: { type: String, required: true },
    state: { type: String, default: 'Delhi' },
    isDefault: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Address', AddressSchema);