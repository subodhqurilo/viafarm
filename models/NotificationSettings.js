const mongoose = require('mongoose');

const NotificationSettingsSchema = new mongoose.Schema({
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
}, {
    timestamps: true
});

module.exports = mongoose.model('NotificationSettings', NotificationSettingsSchema);
