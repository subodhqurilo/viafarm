// services/orderSummary.js
const axios = require("axios");
const Coupon = require("../models/Coupon");
const User = require("../models/User");
const Address = require("../models/Address");

/** -----------------------------------------
 *  HAVERSINE DISTANCE
 * ----------------------------------------- */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** -----------------------------------------
 *  GEOCODE → COORDINATES (lon, lat)
 * ----------------------------------------- */
async function addressToCoords(addr) {
  try {
    const full = [
      addr.houseNumber,
      addr.street,
      addr.locality,
      addr.city,
      addr.district,
      addr.state,
      addr.pinCode,
    ]
      .filter(Boolean)
      .join(", ");

    if (!full) return null;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      full
    )}&format=json&limit=1`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "viafarm-app" },
      timeout: 6000,
    });

    if (!data.length) return null;

    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } catch (err) {
    console.log("⚠ Geocode error:", err.message);
    return null;
  }
}


function parseWeightToKg(weightPerPiece) {
  if (!weightPerPiece) return 0.2; // default 200g

  // already number (just in case)
  if (typeof weightPerPiece === "number") {
    return weightPerPiece > 0 ? weightPerPiece : 0.2;
  }

  if (typeof weightPerPiece !== "string") return 0.2;

  const val = weightPerPiece.toLowerCase().trim();

  let kg = 0.2;

  if (val.endsWith("kg")) {
    kg = parseFloat(val.replace("kg", ""));
  } 
  else if (val.endsWith("g")) {
    kg = parseFloat(val.replace("g", "")) / 1000;
  } 
  else if (val.endsWith("ml")) {
    // 1ml ≈ 1g (food/liquid assumption)
    kg = parseFloat(val.replace("ml", "")) / 1000;
  } 
  else if (!isNaN(val)) {
    kg = parseFloat(val);
  }

  if (isNaN(kg) || kg <= 0) kg = 0.2;

  return kg;
}

module.exports = { parseWeightToKg };
/** -----------------------------------------
 *  SPEED POST RATE TABLE
 * ----------------------------------------- */
function getSpeedPostRate(weightGrams, distanceKm) {
  const weight = Math.min(Math.ceil(weightGrams / 50) * 50, 20000);

  let slab = "above2000";
  if (distanceKm <= 200) slab = "upto200";
  else if (distanceKm <= 1000) slab = "upto1000";
  else if (distanceKm <= 2000) slab = "upto2000";

  const rateTable = {
    50: { upto200: 18, upto1000: 41, upto2000: 41, above2000: 41 },
    200: { upto200: 30, upto1000: 41, upto2000: 47, above2000: 71 },
    500: { upto200: 35, upto1000: 59, upto2000: 71, above2000: 83 },
    1000: { upto200: 47, upto1000: 77, upto2000: 106, above2000: 165 },
    1500: { upto200: 59, upto1000: 94, upto2000: 142, above2000: 189 },
    2000: { upto200: 71, upto1000: 112, upto2000: 177, above2000: 236 },
    2500: { upto200: 83, upto1000: 130, upto2000: 212, above2000: 283 },
    3000: { upto200: 94, upto1000: 148, upto2000: 248, above2000: 330 },
    3500: { upto200: 106, upto1000: 165, upto2000: 283, above2000: 378 },
    4000: { upto200: 118, upto1000: 183, upto2000: 319, above2000: 425 },
    4500: { upto200: 130, upto1000: 201, upto2000: 354, above2000: 472 },
    5000: { upto200: 142, upto1000: 218, upto2000: 389, above2000: 519 },
    6000: { upto200: 165, upto1000: 254, upto2000: 460, above2000: 755 },
    8000: { upto200: 212, upto1000: 325, upto2000: 602, above2000: 991 },
    10000: { upto200: 260, upto1000: 395, upto2000: 743, above2000: 1227 },
    15000: { upto200: 378, upto1000: 572, upto2000: 1097, above2000: 1463 },
    20000: { upto200: 496, upto1000: 749, upto2000: 1451, above2000: 2407 },
  };

  const nearest = Object.keys(rateTable)
    .map(Number)
    .sort((a, b) => a - b)
    .find((w) => weight <= w);

  return { rate: rateTable[nearest][slab] };
}

/** -----------------------------------------
 *  DELIVERY CHARGE (Corrected)
 * ----------------------------------------- */
async function getDeliveryCharge(buyerId, vendorId, totalWeightKg = 1, addressId = null) {
  try {
    const buyerAddress =
      (addressId && await Address.findById(addressId).lean()) ||
      await Address.findOne({ user: buyerId, isDefault: true }).lean();

    if (!buyerAddress) return 50;

    let buyerCoords = buyerAddress.location?.coordinates;
    if (!Array.isArray(buyerCoords)) {
      buyerCoords = await addressToCoords(buyerAddress) || [77, 28.5];
    }

    const vendor = await User.findById(vendorId).lean();
    if (!vendor) return 50;

    let vendorCoords = vendor.location?.coordinates;
    if (!Array.isArray(vendorCoords)) {
      vendorCoords = await addressToCoords(vendor.address || {}) || [77, 28.6];
    }

    const distanceKm = getDistanceKm(
      buyerCoords[1], buyerCoords[0],
      vendorCoords[1], vendorCoords[0]
    );

    const region = vendor.vendorDetails?.deliveryRegion || 5;

    if (distanceKm <= region) {
      if (distanceKm <= 2) return 50;
      return Math.round(50 + (distanceKm - 2) * 10);
    }

    const grams = Math.max(totalWeightKg, 0.2) * 1000;
    return getSpeedPostRate(grams, distanceKm).rate;

  } catch {
    return 50;
  }
}


/** -----------------------------------------
 *  ORDER SUMMARY
 * ----------------------------------------- */
async function calculateOrderSummary(
  cartData,
  couponOrCode,
  deliveryType = "Delivery"
) {
  const items = cartData.items || [];
  const userId = cartData.user || cartData.userId;
  const addressId = cartData.addressId || null;

  let totalMRP = 0;
  let totalWeightKg = 0;

  /* ===============================
     PREPARE ITEMS + WEIGHT
  =============================== */
  const prepared = items.map((i) => {
    const price = i.product.price;
    const qty = i.quantity;

    const itemMRP = price * qty;
    totalMRP += itemMRP;

    // ✅ SAFE WEIGHT CALCULATION (STRING → KG)
    const perPieceKg = parseWeightToKg(i.product.weightPerPiece);
    totalWeightKg += perPieceKg * qty;

    return {
      raw: i,
      vendorId: i.product.vendor._id || i.product.vendor,
      productId: i.product._id,
      categoryId: i.product.category?._id,
      itemMRP,
      qty
    };
  });

  let updatedItems = prepared.map((i) => ({
    ...i.raw,
    itemMRP: i.itemMRP,
    discount: 0,
    total: i.itemMRP
  }));

  /* ===============================
     COUPON LOGIC
  =============================== */
  let totalDiscount = 0;

  if (couponOrCode) {
    const coupon = await Coupon.findOne({
      code: couponOrCode.toUpperCase(),
      status: "Active",
      startDate: { $lte: new Date() },
      expiryDate: { $gte: new Date() }
    })
      .populate("createdBy", "role _id")
      .lean();

    if (coupon) {
      const isAdminCoupon = coupon.createdBy?.role === "Admin";
      const isVendorCoupon = coupon.createdBy?.role === "Vendor";

      let applicableItems = [];

      if (isAdminCoupon) applicableItems = prepared;

      if (isVendorCoupon) {
        applicableItems = prepared.filter(
          (i) => i.vendorId.toString() === coupon.createdBy._id.toString()
        );
      }

      const applicableMRP = applicableItems.reduce(
        (sum, i) => sum + i.itemMRP,
        0
      );

      if (applicableMRP >= coupon.minimumOrder) {
        let discount = 0;

        if (coupon.discount.type === "Percentage") {
          discount = (applicableMRP * coupon.discount.value) / 100;
        } else {
          discount = coupon.discount.value;
        }

        totalDiscount = discount;

        applicableItems.forEach((appItem) => {
          updatedItems = updatedItems.map((u) => {
            if (
              u.product._id.toString() ===
              appItem.raw.product._id.toString()
            ) {
              return {
                ...u,
                discount: (u.discount || 0) + discount,
                total: u.itemMRP - discount
              };
            }
            return u;
          });
        });
      }
    }
  }

  /* ===============================
     DELIVERY CHARGE
  =============================== */
  const vendorId = prepared[0]?.vendorId;

  const deliveryCharge =
    deliveryType === "Delivery"
      ? await getDeliveryCharge(
          userId,
          vendorId,
          totalWeightKg, // ✅ FIXED WEIGHT
          addressId
        )
      : 0;

  const finalAmount = totalMRP - totalDiscount + deliveryCharge;

  return {
    items: updatedItems,
    summary: {
      totalMRP,
      discount: totalDiscount,
      deliveryCharge,
      totalAmount: finalAmount
    }
  };
}


module.exports = { calculateOrderSummary, getDeliveryCharge ,parseWeightToKg };
