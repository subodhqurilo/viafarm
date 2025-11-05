const axios = require('axios');

// Convert full address (string) ➜ coordinates [lng, lat]
exports.addressToCoords = async (address) => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'fruit-vegitable-app' }
    });
    if (!data.length) return null;
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } catch (err) {
    console.error('Address→Coords error:', err.message);
    return null;
  }
};

// Convert coordinates [lat, lng] ➜ full address
exports.coordsToAddress = async (lat, lon) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'fruit-vegitable-app' }
    });

    const addr = data.address || {};
    return {
      fullAddress: data.display_name,
      pinCode: addr.postcode || '',
      city: addr.city || addr.town || addr.village || '',
      district: addr.county || '',
      state: addr.state || '',
      country: addr.country || ''
    };
  } catch (err) {
    console.error('Coords→Address error:', err.message);
    return null;
  }
};
