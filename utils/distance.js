// utils/distance.js

/**
 * 🔢 Raw distance in KM (DO NOT CHANGE – already used)
 */
exports.calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius (km)

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * 🧾 Distance TEXT (Frontend safe)
 * input  : buyerCoords [lng, lat], vendorCoords [lng, lat]
 * output : "12.47 km away" | "N/A"
 */
exports.getDistanceText = (buyerCoords, vendorCoords) => {
  if (
    !Array.isArray(buyerCoords) ||
    !Array.isArray(vendorCoords) ||
    buyerCoords.length !== 2 ||
    vendorCoords.length !== 2
  ) {
    return "N/A";
  }

  const [buyerLng, buyerLat] = buyerCoords.map(Number);
  const [vendorLng, vendorLat] = vendorCoords.map(Number);

  if (
    [buyerLat, buyerLng, vendorLat, vendorLng].some(
      (v) => isNaN(v) || v === 0
    )
  ) {
    return "N/A";
  }

  const km = exports.calculateDistanceKm(
    buyerLat,
    buyerLng,
    vendorLat,
    vendorLng
  );

  return `${km.toFixed(2)} km away`;
};
