const axios = require("axios");
const Coupon = require("../models/Coupon");
const User = require("../models/User");
const Address = require("../models/Address");

/**
 * --- Haversine formula (in km) ---
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * --- Address → Coordinates using OpenStreetMap ---
 */
async function addressToCoords(address) {
  try {
    const fullAddress = [
      address?.houseNumber,
      address?.locality,
      address?.city,
      address?.district,
      address?.state,
      address?.pinCode,
    ]
      .filter(Boolean)
      .join(", ");

    if (!fullAddress) return null;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      fullAddress
    )}&format=json&limit=1`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "viafarm-app" },
    });

    if (!data.length) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    return [lon, lat];
  } catch (err) {
    console.error("❌ Geocode error:", err.message);
    return null;
  }
}

/**
 * --- Speed Post Rate Table ---
 */
function getSpeedPostRate(weightGrams, distanceKm) {
  // normalize
  const weight = Math.ceil(weightGrams / 50) * 50; // next 50g step
  const ranges = [
    { limit: 200, key: "upto200" },
    { limit: 1000, key: "upto1000" },
    { limit: 2000, key: "upto2000" },
    { limit: Infinity, key: "above2000" },
  ];

  const slab = ranges.find((r) => distanceKm <= r.limit)?.key;

  // simplified rates table (from image)
  const rateTable = {
    50: { upto200: 18, upto1000: 41, upto2000: 41, above2000: 41 },
    200: { upto200: 30, upto1000: 41, upto2000: 47, above2000: 71 },
    500: { upto200: 35, upto1000: 59, upto2000: 71, above2000: 83 },
    1000: { upto200: 47, upto1000: 77, upto2000: 106, above2000: 165 },
    1500: { upto200: 59, upto1000: 94, upto2000: 142, above2000: 189 },
    2000: { upto200: 71, upto1000: 112, upto2000: 177, above2000: 236 },
    2500: { upto200: 83, upto1000: 130, upto2000: 212, above2000: 283 },
    3000: { upto200: 94, upto1000: 148, upto2000: 248, above2000: 330 },
  };

  const rate =
    rateTable[weight] && rateTable[weight][slab]
      ? rateTable[weight][slab]
      : 200; // default if higher

  return rate;
}

/**
 * --- Delivery charge calculator ---
 */
async function getDeliveryCharge(buyerId, vendorId, totalWeightKg = 1) {
  try {
    console.log("🚀 Running getDeliveryCharge()");
    console.log("➡️ Buyer ID:", buyerId);
    console.log("➡️ Vendor ID:", vendorId);

    // 1️⃣ Fetch buyer & vendor
    let buyerAddress = await Address.findOne({ user: buyerId, isDefault: true }).lean();
    if (!buyerAddress) buyerAddress = await Address.findOne({ user: buyerId }).lean();
    const vendor = await User.findById(vendorId).lean();

    if (!buyerAddress || !vendor) {
      console.warn("⚠️ Missing buyer or vendor data");
      return 50;
    }

    // 2️⃣ Ensure coordinates exist (fallback to geocode)
    if (!buyerAddress?.location?.coordinates) {
      const coords = await addressToCoords(buyerAddress);
      if (coords) {
        buyerAddress.location = { type: "Point", coordinates: coords };
        await Address.updateOne({ _id: buyerAddress._id }, { $set: { location: buyerAddress.location } });
      }
    }

    if (!vendor?.location?.coordinates) {
      const coords = await addressToCoords(vendor.address);
      if (coords) {
        vendor.location = { type: "Point", coordinates: coords };
        await User.updateOne({ _id: vendor._id }, { $set: { location: vendor.location } });
      }
    }

    const [buyerLng, buyerLat] = buyerAddress.location.coordinates;
    const [vendorLng, vendorLat] = vendor.location.coordinates;
    const distanceKm = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);

    console.log(`📏 Distance: ${distanceKm.toFixed(2)} km`);

    const deliveryRegion = vendor.vendorDetails?.deliveryRegion || 5;
    const sameState = buyerAddress?.state?.toLowerCase() === vendor?.state?.toLowerCase();

    let charge = 0;

    // 3️⃣ Within vendor region logic
    if (distanceKm <= deliveryRegion) {
      charge = distanceKm <= 2 ? 50 : 50 + (distanceKm - 2) * 10;
      console.log(`✅ Within region | Charge = ₹${charge.toFixed(2)}`);
    } else {
      // 4️⃣ Outside region → Speed Post rate chart
      const totalWeightGrams = totalWeightKg * 1000;
      charge = getSpeedPostRate(totalWeightGrams, distanceKm);
      console.log(`🚚 Outside region | Based on SpeedPost | ₹${charge}`);
    }

    return parseFloat(charge.toFixed(2));
  } catch (err) {
    console.error("❌ getDeliveryCharge error:", err);
    return 50;
  }
}

/**
 * --- Main order summary calculator ---
 */
async function calculateOrderSummary(cartOrItems, couponCode, deliveryType = "Delivery") {
  const items = Array.isArray(cartOrItems) ? cartOrItems : cartOrItems?.items || [];

  let totalMRP = 0;
  let totalDiscount = 0;
  let totalWeight = 0;
  const updatedItems = [];

  const coupon = couponCode
    ? await Coupon.findOne({ code: couponCode.toUpperCase(), status: "Active" })
    : null;

  for (const item of items) {
    const price = typeof item.price === "number" ? item.price : item.product?.price || 0;
    const qty = Number(item.quantity) || 0;
    const itemMRP = price * qty;
    totalMRP += itemMRP;
    totalWeight += (item.product?.weightPerPiece || 0.2) * qty;

    let itemDiscount = 0;

    if (coupon) {
      if (
        coupon.appliesTo.includes("All Products") ||
        (item.product?._id && coupon.applicableProducts?.some((p) => p.equals(item.product._id)))
      ) {
        if (coupon.discount.type === "Percentage") {
          itemDiscount = (itemMRP * coupon.discount.value) / 100;
        } else if (coupon.discount.type === "Fixed") {
          const totalQualifyingMRP = items.reduce((sum, i) => {
            if (
              coupon.appliesTo.includes("All Products") ||
              coupon.applicableProducts?.some((p) => p.equals(i.product?._id))
            ) {
              return sum + ((i.price || i.product?.price || 0) * (i.quantity || 0));
            }
            return sum;
          }, 0);
          itemDiscount = (itemMRP / totalQualifyingMRP) * coupon.discount.value;
        }
      }
    }

    totalDiscount += itemDiscount;
    updatedItems.push({
      ...item.toObject?.() || item,
      itemMRP: +itemMRP.toFixed(2),
      discount: +itemDiscount.toFixed(2),
      total: +(itemMRP - itemDiscount).toFixed(2),
    });
  }

  const buyerId = cartOrItems.user || cartOrItems.userId;
  const vendorId = items[0]?.vendor?.toString() || items[0]?.product?.vendor?.toString();

  let deliveryCharge = 0;
  if (deliveryType === "Delivery" && vendorId) {
    deliveryCharge = await getDeliveryCharge(buyerId, vendorId, totalWeight);
  }

  const finalTotal = totalMRP - totalDiscount + deliveryCharge;

  return {
    items: updatedItems,
    summary: {
      totalMRP: +totalMRP.toFixed(2),
      discount: +totalDiscount.toFixed(2),
      deliveryCharge,
      totalAmount: +finalTotal.toFixed(2),
    },
  };
}

module.exports = { calculateOrderSummary, getDeliveryCharge };
