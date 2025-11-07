const axios = require('axios');

/**
 * 🔍 Convert a full address string into geographic coordinates [longitude, latitude].
 * @param {string} address - Full human-readable address.
 * @returns {Promise<[number, number] | null>} Coordinates in GeoJSON order or null if not found.
 */
exports.addressToCoords = async (address) => {
  try {
    if (!address || typeof address !== 'string' || !address.trim()) {
      console.warn('⚠️ addressToCoords: Invalid or empty address input.');
      return null;
    }

    const url = `https://nominatim.openstreetmap.org/search`;
    const { data } = await axios.get(url, {
      params: {
        q: address,
        format: 'json',
        limit: 1,
      },
      headers: {
        'User-Agent': 'viafarm-app/1.0 (viafarm.in)',
      },
      timeout: 8000, // prevent hanging requests
    });

    if (!data || !data.length) {
      console.warn(`⚠️ addressToCoords: No results for "${address}"`);
      return null;
    }

    const { lon, lat } = data[0];
    return [parseFloat(lon), parseFloat(lat)];
  } catch (err) {
    console.error('❌ addressToCoords error:', err.message);
    return null;
  }
};

/**
 * 📍 Convert coordinates [latitude, longitude] into structured address info.
 * @param {number|string} lat - Latitude.
 * @param {number|string} lon - Longitude.
 * @returns {Promise<Object|null>} Object containing structured address info.
 */
exports.coordsToAddress = async (lat, lon) => {
  try {
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      console.warn('⚠️ coordsToAddress: Invalid coordinates provided.');
      return null;
    }

    const url = `https://nominatim.openstreetmap.org/reverse`;
    const { data } = await axios.get(url, {
      params: {
        lat,
        lon,
        format: 'json',
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'viafarm-app/1.0 (viafarm.in)',
      },
      timeout: 8000,
    });

    if (!data || !data.address) {
      console.warn(`⚠️ coordsToAddress: No address found for ${lat}, ${lon}`);
      return null;
    }

    const addr = data.address;
    return {
      fullAddress: data.display_name || '',
      pinCode: addr.postcode || '',
      city: addr.city || addr.town || addr.village || addr.hamlet || '',
      district: addr.state_district || addr.county || '',
      state: addr.state || '',
      country: addr.country || '',
      locality: addr.suburb || addr.neighbourhood || addr.road || '',
    };
  } catch (err) {
    console.error('❌ coordsToAddress error:', err.message);
    return null;
  }
};
