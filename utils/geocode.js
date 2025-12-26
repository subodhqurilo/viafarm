const axios = require("axios");

/**
 * 🔍 Convert a full address string into geographic coordinates [longitude, latitude]
 */
exports.addressToCoords = async (address) => {
  try {
    if (!address || typeof address !== "string" || !address.trim()) {
      console.warn("⚠️ addressToCoords: Invalid or empty address input.");
      return null;
    }

    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: address,
          format: "json",
          limit: 1,
        },
        headers: {
          "User-Agent": "viafarm-app/1.0 (viafarm.in)",
        },
        timeout: 8000,
      }
    );

    if (!data || !data.length) return null;

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);

    if (isNaN(lat) || isNaN(lng)) return null;

    return [lng, lat]; // ✅ GeoJSON order
  } catch (err) {
    console.error("❌ addressToCoords error:", err.message);
    return null;
  }
};

/**
 * 📍 Convert coordinates into structured address
 */
exports.coordsToAddress = async (lat, lon) => {
  try {
    if (
      lat === undefined ||
      lon === undefined ||
      isNaN(lat) ||
      isNaN(lon)
    ) {
      console.warn("⚠️ coordsToAddress: Invalid coordinates provided.");
      return null;
    }

    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          lat,
          lon,
          format: "json",
          addressdetails: 1,
        },
        headers: {
          "User-Agent": "viafarm-app/1.0 (viafarm.in)",
        },
        timeout: 8000,
      }
    );

    if (!data || !data.address) return null;

    const addr = data.address;

    return {
      fullAddress: data.display_name || "",
      pinCode: addr.postcode || "",
      city: addr.city || addr.town || addr.village || addr.hamlet || "",
      district: addr.state_district || addr.county || "",
      state: addr.state || "",
      country: addr.country || "",
      locality: addr.suburb || addr.neighbourhood || addr.road || "",
    };
  } catch (err) {
    console.error("❌ coordsToAddress error:", err.message);
    return null;
  }
};
