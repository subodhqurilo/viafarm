const mongoose = require('mongoose');

const CustomerSupportSchema = new mongoose.Schema({
    // Unique identifier to ensure only one settings document exists
    appId: {
        type: String,
        required: true,
        default: 'customer_support_settings',
        unique: true
    },
    phone: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    operatingHours: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('CustomerSupport', CustomerSupportSchema);
