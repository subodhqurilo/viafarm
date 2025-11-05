const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    pinCode: { type: String, required: true },
    houseNumber: { type: String, required: true },
    locality: { type: String, required: true },
    city: { type: String, required: true },
    district: { type: String, required: true },
    state: { type: String, default: 'Delhi' },
    isDefault: { type: Boolean, default: false },

    
    location: {
        type: {
            type: String,
            enum: ['Point'], 
        },
        coordinates: {
            type: [Number], 
        }
    }

}, { timestamps: true });

// Optional: only create index if you plan to do geospatial queries
AddressSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Address', AddressSchema);
