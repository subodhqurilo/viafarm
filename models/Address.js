const mongoose = require('mongoose');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');

const AddressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  pinCode: { type: String },
  houseNumber: { type: String },
  locality: { type: String },
  city: { type: String },
  district: { type: String },
  state: { type: String, default: 'Delhi' },
  isDefault: { type: Boolean, default: false },

  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] } // [longitude, latitude]
  }
}, { timestamps: true });

// ✅ Auto-fill location or address before save
AddressSchema.pre('save', async function (next) {
  try {
    const address = this;

    // 🧭 If address fields exist but no coordinates → geocode
    if ((!address.location?.coordinates?.length || address.location.coordinates[0] === 0) &&
        address.city && address.state && address.pinCode) {

      const addressStr = `${address.houseNumber || ''} ${address.locality || ''} ${address.city} ${address.district || ''} ${address.state} ${address.pinCode}`;
      const coords = await addressToCoords(addressStr);
      if (coords) address.location = { type: 'Point', coordinates: coords };
    }

    // 📍 If coordinates exist but no address → reverse geocode
    else if (address.location?.coordinates?.length &&
             (!address.city || !address.pinCode)) {

      const [lng, lat] = address.location.coordinates;
      const addrData = await coordsToAddress(lat, lng);
      if (addrData) {
        address.city = address.city || addrData.city;
        address.state = address.state || addrData.state;
        address.district = address.district || addrData.district;
        address.pinCode = address.pinCode || addrData.pinCode;
      }
    }

    next();
  } catch (err) {
    console.error('Address pre-save geocode error:', err);
    next();
  }
});

AddressSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Address', AddressSchema);
