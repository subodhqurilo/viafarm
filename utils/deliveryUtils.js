// utils/deliveryUtils.js

// 1️⃣ Calculate Distance (Haversine formula)
const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of Earth (km)
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// 2️⃣ Calculate Estimated Delivery Date + Distance
const calculateEstimatedDelivery = (vendor, buyer, orderTime = new Date()) => {
  // Defensive checks
  if (!vendor || !buyer) {
    return {
      formatted: "Delivery estimate unavailable",
      date: null,
      distanceKm: null
    };
  }

  if (
    !vendor.location?.coordinates ||
    !buyer.location?.coordinates ||
    vendor.location.coordinates.length < 2 ||
    buyer.location.coordinates.length < 2
  ) {
    return {
      formatted: "Delivery estimate unavailable",
      date: null,
      distanceKm: null
    };
  }

  const [vendorLng, vendorLat] = vendor.location.coordinates;
  const [buyerLng, buyerLat] = buyer.location.coordinates;

  const distanceKm = calculateDistanceKm(vendorLat, vendorLng, buyerLat, buyerLng);

  let deliveryDate = new Date(orderTime);

  // ✅ Buyer inside vendor delivery region
  if (vendor.deliveryRegion && distanceKm <= vendor.deliveryRegion) {
    const cutoffHour = 17; // 5 PM cutoff for same-day delivery
    if (orderTime.getHours() >= cutoffHour) {
      deliveryDate.setDate(deliveryDate.getDate() + 1); // next day delivery
    }
  } else {
    // ✅ Buyer outside vendor delivery region (speed post logic)
    let daysToAdd = 4; // default (different state)
    if (vendor?.address?.state && buyer?.address?.state) {
      if (vendor.address.state === buyer.address.state) {
        daysToAdd = 2 + Math.floor(Math.random() * 2); // 2–3 days if same state
      }
    }
    deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
  }

  // Format readable date
  const formatted = deliveryDate.toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });

  return {
    formatted, // e.g., "Fri, 17 Oct 2025"
    date: deliveryDate.toISOString(),
    distanceKm: distanceKm.toFixed(1)
  };
};

// 3️⃣ Simple Formatter Helper
const formatDeliveryDate = (date) => {
  if (!date) return "N/A";
  const deliveryDate = new Date(date);
  deliveryDate.setDate(deliveryDate.getDate() + 3);
  const options = { weekday: "short", day: "2-digit", month: "short", year: "numeric" };
  const formatted = deliveryDate.toLocaleDateString("en-US", options);
  return formatted;
};

module.exports = { calculateEstimatedDelivery, calculateDistanceKm, formatDeliveryDate };
