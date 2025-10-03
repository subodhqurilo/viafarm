const mongoose = require('mongoose');

const NotificationSettingsSchema = new mongoose.Schema({
    // Unique identifier for the single settings document
    appId: {
        type: String,
        required: true,
        default: 'app_settings',
        unique: true
    },
    orderPlaced: {
        type: Boolean,
        default: true
    },
    orderCancelled: {
        type: Boolean,
        default: true
    },
    orderPickedUpDelivered: {
        type: Boolean,
        default: true
    },
    priceDrop: {
        type: Boolean,
        default: true
    },
    // Add other notification types as needed
}, {
    timestamps: true
});

module.exports = mongoose.model('NotificationSettings', NotificationSettingsSchema);