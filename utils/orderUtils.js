// services/orderSummary.js
const axios = require("axios");
const Coupon = require("../models/Coupon");
const User = require("../models/User");
const Address = require("../models/Address");

/** --- Haversine formula (in km) --- */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** --- Address → Coordinates using OpenStreetMap --- */
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

    if (!data || !data.length) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    return [lon, lat];
  } catch (err) {
    console.error("❌ Geocode error:", err.message || err);
    return null;
  }
}

/** --- Speed Post Rate Table (unchanged logic) --- */
function getSpeedPostRate(weightGrams, distanceKm) {
  const weight = Math.min(Math.ceil(weightGrams / 50) * 50, 20000);

  const distanceSlabs = [
    { limit: 200, key: "upto200" },
    { limit: 1000, key: "upto1000" },
    { limit: 2000, key: "upto2000" },
    { limit: Infinity, key: "above2000" },
  ];
  const slab = distanceSlabs.find((r) => distanceKm <= r.limit)?.key || "above2000";

  const rateTable = {
    50:   { upto200: 18,  upto1000: 41,   upto2000: 41,   above2000: 41 },
    200:  { upto200: 30,  upto1000: 41,   upto2000: 47,   above2000: 71 },
    500:  { upto200: 35,  upto1000: 59,   upto2000: 71,   above2000: 83 },
    1000: { upto200: 47,  upto1000: 77,   upto2000: 106,  above2000: 165 },
    1500: { upto200: 59,  upto1000: 94,   upto2000: 142,  above2000: 189 },
    2000: { upto200: 71,  upto1000: 112,  upto2000: 177,  above2000: 236 },
    2500: { upto200: 83,  upto1000: 130,  upto2000: 212,  above2000: 283 },
    3000: { upto200: 94,  upto1000: 148,  upto2000: 248,  above2000: 330 },
    3500: { upto200: 106, upto1000: 165,  upto2000: 283,  above2000: 378 },
    4000: { upto200: 118, upto1000: 183,  upto2000: 319,  above2000: 425 },
    4500: { upto200: 130, upto1000: 201,  upto2000: 354,  above2000: 472 },
    5000: { upto200: 142, upto1000: 218,  upto2000: 389,  above2000: 519 },
    6000: { upto200: 165, upto1000: 254,  upto2000: 460,  above2000: 755 },
    8000: { upto200: 212, upto1000: 325,  upto2000: 602,  above2000: 991 },
    10000:{ upto200: 260, upto1000: 395,  upto2000: 743,  above2000: 1227 },
    15000:{ upto200: 378, upto1000: 572,  upto2000:1097,  above2000:1463 },
    20000:{ upto200: 496, upto1000: 749,  upto2000:1451,  above2000:2407 },
  };

  const availableWeights = Object.keys(rateTable).map(Number);
  const nearest = availableWeights.find((w) => weight <= w) || 20000;

  const rate = rateTable[nearest]?.[slab] || 200;
  return { rate, weight: nearest, distanceCategory: slab };
}

/** --- Delivery charge calculator --- */
async function getDeliveryCharge(buyerId, vendorId, totalWeightKg = 1) {
  try {
    let buyerAddress = await Address.findOne({ user: buyerId, isDefault: true }).lean();
    if (!buyerAddress) buyerAddress = await Address.findOne({ user: buyerId }).lean();
    const vendor = await User.findById(vendorId).lean();

    if (!buyerAddress || !vendor) {
      console.warn("⚠️ Missing buyer or vendor data");
      return 50;
    }

    if (!buyerAddress?.location?.coordinates) {
      const coords = await addressToCoords(buyerAddress);
      if (coords) {
        buyerAddress.location = { type: "Point", coordinates: coords };
        await Address.updateOne({ _id: buyerAddress._id }, { $set: { location: buyerAddress.location } });
      } else {
        return 50;
      }
    }

    if (!vendor?.location?.coordinates && vendor.address) {
      const coords = await addressToCoords(vendor.address);
      if (coords) {
        vendor.location = { type: "Point", coordinates: coords };
        await User.updateOne({ _id: vendor._id }, { $set: { location: vendor.location } });
      } else {
        return 50;
      }
    }

    const [buyerLng, buyerLat] = buyerAddress.location.coordinates;
    const [vendorLng, vendorLat] = vendor.location.coordinates;
    const distanceKm = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);

    const deliveryRegion = vendor.vendorDetails?.deliveryRegion || 5;

    let charge = 0;
    if (distanceKm <= deliveryRegion) {
      charge = distanceKm <= 2 ? 50 : 50 + (distanceKm - 2) * 10;
    } else {
      const totalWeightGrams = totalWeightKg * 1000;
      const sp = getSpeedPostRate(totalWeightGrams, distanceKm);
      charge = sp.rate || 200;
    }

    return parseFloat(Number(charge).toFixed(2));
  } catch (err) {
    console.error("❌ getDeliveryCharge error:", err);
    return 50;
  }
}

/**
 * --- Main order summary calculator (FULLY FIXED) ---
 *
 * Accepts:
 *  - cartOrItems: { items: [...] } OR an array of items
 *  - couponOrCode: either a coupon object (from DB) OR a coupon code string (like "FR2")
 *
 * Item structure expected (each item): {
 *   product: { _id, price, category (either string OR populated {name}), weightPerPiece, vendor },
 *   quantity
 * }
 */
async function calculateOrderSummary(cartOrItems, couponOrCode, deliveryType = "Delivery") {
  const itemsArray = Array.isArray(cartOrItems) ? cartOrItems : cartOrItems?.items || [];

  // Normalize items: ensure product present
  const items = itemsArray.filter(i => i && (i.product || i.product === 0));

  // 1) Build item details and compute totals
  let totalMRP = 0;
  let totalWeight = 0;
  const prepared = items.map((item) => {
    const price = typeof item.price === "number" ? item.price : (item.product?.price || 0);
    const qty = Number(item.quantity) || 0;
    const itemMRP = price * qty;
    totalMRP += itemMRP;
    totalWeight += (item.product?.weightPerPiece || 0.2) * qty;

    // get category name robustly (category may be populated object or string)
    let productCategory = null;
    if (item.product?.category) {
      if (typeof item.product.category === "string") productCategory = item.product.category;
      else if (item.product.category?.name) productCategory = item.product.category.name;
    }

    return {
      raw: item,
      productId: item.product?._id,
      price,
      qty,
      itemMRP,
      productCategory, // e.g. "Fruits"
      vendorId: item.product?.vendor?.toString?.() || null
    };
  });

  // 2) Resolve coupon (accept coupon object OR coupon code string)
  let coupon = null;
  if (couponOrCode) {
    // If an object that seems like coupon (has _id or code), use it directly
    if (typeof couponOrCode === "object" && couponOrCode._id) {
      coupon = couponOrCode;
    } else if (typeof couponOrCode === "string" && couponOrCode.trim() !== "") {
      coupon = await Coupon.findOne({
        code: couponOrCode.trim().toUpperCase(),
        status: "Active",
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      }).lean();
      // lean -> plain object
    }
  }

  // 3) If coupon exists but minimumOrder not met => treat as no-coupon (no discount)
  if (coupon && coupon.minimumOrder && totalMRP < Number(coupon.minimumOrder || 0)) {
    coupon = null;
  }

  // 4) Pre-calc total qualifying MRP for fixed coupons that target subset
  let totalQualifyingMRP = 0;
  if (coupon && coupon.discount && coupon.discount.type === "Fixed") {
    // Qualify items by category or product or All Products
    for (const it of prepared) {
      const catMatch = coupon.appliesTo?.includes("All Products") ||
                       (it.productCategory && coupon.appliesTo?.includes(it.productCategory));
      const prodMatch = coupon.applicableProducts?.some?.(p => {
        try { return p.equals?.(it.productId) || String(p) === String(it.productId); } catch { return false; }
      });

      if (catMatch || prodMatch) totalQualifyingMRP += it.itemMRP;
    }
  }

  // 5) Compute per-item discount according to coupon rules
  let totalDiscount = 0;
  const updatedItems = prepared.map((it) => {
    let itemDiscount = 0;

    if (coupon) {
      const catMatch = coupon.appliesTo?.includes("All Products") ||
                       (it.productCategory && coupon.appliesTo?.includes(it.productCategory));

      const prodMatch = coupon.applicableProducts?.some?.(p => {
        try { return p.equals?.(it.productId) || String(p) === String(it.productId); } catch { return false; }
      });

      if (catMatch || prodMatch) {
        if (coupon.discount?.type === "Percentage") {
          itemDiscount = (it.itemMRP * Number(coupon.discount.value || 0)) / 100;
        } else if (coupon.discount?.type === "Fixed") {
          // If no qualifying MRP (edge), avoid division by zero => no discount
          if (totalQualifyingMRP > 0) {
            itemDiscount = (it.itemMRP / totalQualifyingMRP) * Number(coupon.discount.value || 0);
          } else {
            itemDiscount = 0;
          }
        }
      }
    }

    itemDiscount = Number(itemDiscount) || 0;
    totalDiscount += itemDiscount;

    // build returned shape (keep original item contents)
    const original = it.raw;
    const base = original.toObject?.() || original;
    return {
      ...base,
      itemMRP: +it.itemMRP.toFixed(2),
      discount: +itemDiscount.toFixed(2),
      total: +((it.itemMRP - itemDiscount)).toFixed(2),
    };
  });

  // 6) Delivery charge (per vendor - here we pick vendor from first item)
  const buyerId = (Array.isArray(cartOrItems) ? (cartOrItems.user || null) : cartOrItems.user) || cartOrItems.userId;
  const vendorId = prepared[0]?.vendorId || null;
  let deliveryCharge = 0;
  if (deliveryType === "Delivery" && vendorId) {
    deliveryCharge = await getDeliveryCharge(buyerId, vendorId, totalWeight);
  }

  const finalTotal = (totalMRP - totalDiscount + deliveryCharge);

  return {
    items: updatedItems,
    summary: {
      totalMRP: +totalMRP.toFixed(2),
      discount: +totalDiscount.toFixed(2),
      deliveryCharge: +Number(deliveryCharge).toFixed(2),
      totalAmount: +Number(finalTotal).toFixed(2),
    }
  };
}

module.exports = { calculateOrderSummary, getDeliveryCharge };
