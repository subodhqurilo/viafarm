// utils/deliveryUtils.js

const { calculateDistanceKm } = require("./distance");

/**
 * 🚚 Calculate Estimated Delivery (distance + ETA)
 * vendor.location.coordinates = [lng, lat]
 * buyer.location.coordinates  = [lng, lat]
 */
const calculateEstimatedDelivery = (
  vendor,
  buyer,
  orderTime = new Date()
) => {
  /* ==============================
     1️⃣ SAFETY CHECKS
  ============================== */
  if (
    !vendor?.location?.coordinates ||
    !buyer?.location?.coordinates ||
    vendor.location.coordinates.length !== 2 ||
    buyer.location.coordinates.length !== 2
  ) {
    return {
      formatted: "Delivery estimate unavailable",
      date: null,
      distanceKm: null,
    };
  }

  const [vendorLng, vendorLat] = vendor.location.coordinates.map(Number);
  const [buyerLng, buyerLat] = buyer.location.coordinates.map(Number);

  if (
    [vendorLat, vendorLng, buyerLat, buyerLng].some(
      (v) => isNaN(v) || v === 0
    )
  ) {
    return {
      formatted: "Delivery estimate unavailable",
      date: null,
      distanceKm: null,
    };
  }

  /* ==============================
     2️⃣ DISTANCE (SINGLE SOURCE)
  ============================== */
  const distanceKm = calculateDistanceKm(
    vendorLat,
    vendorLng,
    buyerLat,
    buyerLng
  );

  /* ==============================
     3️⃣ DELIVERY DATE LOGIC
  ============================== */
  const deliveryDate = new Date(orderTime);

  // ✅ Inside delivery radius
  if (
    typeof vendor.vendorDetails?.deliveryRegion === "number" &&
    distanceKm <= vendor.vendorDetails.deliveryRegion
  ) {
    const cutoffHour = 17; // 5 PM
    if (orderTime.getHours() >= cutoffHour) {
      deliveryDate.setDate(deliveryDate.getDate() + 1);
    }
  } else {
    // 🚚 Outside region (courier logic)
    let daysToAdd = 4;

    if (
      vendor.address?.state &&
      buyer.address?.state &&
      vendor.address.state === buyer.address.state
    ) {
      daysToAdd = 2 + Math.floor(Math.random() * 2); // 2–3 days
    }

    deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
  }

  /* ==============================
     4️⃣ FORMAT DATE
  ============================== */
  const formatted = deliveryDate.toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return {
    formatted,                  // "Fri, 17 Oct 2025"
    date: deliveryDate.toISOString(),
    distanceKm: Number(distanceKm.toFixed(1)),
  };
};

/**
 * 🧾 Simple formatter (fallback)
 */
const formatDeliveryDate = (date) => {
  if (!date) return "N/A";
  const d = new Date(date);
  d.setDate(d.getDate() + 3);

  return d.toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

module.exports = {
  calculateEstimatedDelivery,
  formatDeliveryDate,
};
