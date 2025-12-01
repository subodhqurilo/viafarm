const axios = require("axios");
const Coupon = require("../models/Coupon");
const User = require("../models/User");
const Address = require("../models/Address");

/** --- Haversine formula --- */
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

/** --- Geocode address → coordinates --- */
async function addressToCoords(address) {
  try {
    const fullAddress = [
      address?.houseNumber,
      address?.street,
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

    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } catch {
    return null;
  }
}

/** --- Speed Post Rate Table --- */
function getSpeedPostRate(weightGrams, distanceKm) {
  const weight = Math.min(Math.ceil(weightGrams / 50) * 50, 20000);

  const slabs = [
    { limit: 200, key: "upto200" },
    { limit: 1000, key: "upto1000" },
    { limit: 2000, key: "upto2000" },
    { limit: Infinity, key: "above2000" },
  ];
  const slab = slabs.find((r) => distanceKm <= r.limit)?.key || "above2000";

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
    .find((w) => weight <= w);

  return { rate: rateTable[nearest][slab] };
}

/** --------------------------------------------------
 *  DELIVERY CHARGE — FIXED VERSION
 *  -------------------------------------------------- */
async function getDeliveryCharge(
  buyerId,
  vendorId,
  totalWeightKg = 1,
  selectedAddressId = null
) {
  try {
    let buyerAddress = null;

    // 🔥 Use Selected Address (Main FIX)
    if (selectedAddressId) {
      buyerAddress = await Address.findById(selectedAddressId).lean();
    }

    // Fallback to default
    if (!buyerAddress) {
      buyerAddress =
        (await Address.findOne({ user: buyerId, isDefault: true }).lean()) ||
        (await Address.findOne({ user: buyerId }).lean());
    }

    const vendor = await User.findById(vendorId).lean();

    if (!buyerAddress || !vendor) return 50;

    // If buyer has no coordinates → geocode
    if (!buyerAddress.location?.coordinates) {
      const coords = await addressToCoords(buyerAddress);
      if (coords) {
        buyerAddress.location = { type: "Point", coordinates: coords };
        await Address.updateOne(
          { _id: buyerAddress._id },
          { $set: { location: buyerAddress.location } }
        );
      } else return 50;
    }

    // If vendor has no coordinates → geocode
    if (!vendor.location?.coordinates) {
      const coords = await addressToCoords(vendor.address);
      if (coords) {
        vendor.location = { type: "Point", coordinates: coords };
        await User.updateOne(
          { _id: vendor._id },
          { $set: { location: vendor.location } }
        );
      } else return 50;
    }

    const [bLng, bLat] = buyerAddress.location.coordinates;
    const [vLng, vLat] = vendor.location.coordinates;

    const distanceKm = getDistanceKm(bLat, bLng, vLat, vLng);

    const deliveryRegion = vendor.vendorDetails?.deliveryRegion || 5;

    let charge = 0;

    if (distanceKm <= deliveryRegion) {
      charge = distanceKm <= 2 ? 50 : 50 + (distanceKm - 2) * 10;
    } else {
      const grams = totalWeightKg * 1000;
      const sp = getSpeedPostRate(grams, distanceKm);
      charge = sp.rate || 200;
    }

    return +charge.toFixed(2);
  } catch (err) {
    return 50;
  }
}

/** --------------------------------------------------
 *  MAIN SUMMARY CALCULATOR  (UPDATED)
 *  -------------------------------------------------- */
async function calculateOrderSummary(
  cartData,
  couponOrCode,
  deliveryType = "Delivery"
) {
  const items = cartData.items || [];
  const userId = cartData.user || cartData.userId;
  const selectedAddressId = cartData.addressId || null;

  let totalMRP = 0;
  let totalWeight = 0;

  const prepared = items.map((item) => {
    const price = item.product.price;
    const qty = item.quantity;
    const itemMRP = price * qty;

    totalMRP += itemMRP;
    totalWeight += (item.product.weightPerPiece || 0.2) * qty;

    return {
      raw: item,
      productId: item.product._id,
      vendorId: item.product.vendor._id || item.product.vendor,
      price,
      qty,
      itemMRP,
      productCategory: item.product.category?.name || "",
    };
  });

  /** ---- Coupon logic ---- */
  let coupon = null;

  if (couponOrCode) {
    if (typeof couponOrCode === "object") coupon = couponOrCode;
    else {
      coupon = await Coupon.findOne({
        code: couponOrCode.toUpperCase(),
        status: "Active",
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).lean();
    }
  }

  if (coupon && coupon.minimumOrder > totalMRP) coupon = null;

  let totalDiscount = 0;
  const updatedItems = prepared.map((it) => {
    let disc = 0;

    if (coupon) {
      const isApplicable =
        coupon.appliesTo.includes("All Products") ||
        coupon.appliesTo.includes(it.productCategory);

      if (isApplicable) {
        if (coupon.discount.type === "Percentage") {
          disc = (it.itemMRP * coupon.discount.value) / 100;
        } else {
          disc = (it.itemMRP / totalMRP) * coupon.discount.value;
        }
      }
    }

    totalDiscount += disc;

    return {
      ...it.raw,
      itemMRP: +it.itemMRP.toFixed(2),
      discount: +disc.toFixed(2),
      total: +(it.itemMRP - disc).toFixed(2),
    };
  });

  /** ---- Delivery Charge ---- */
  const vendorId = prepared[0]?.vendorId;
  let deliveryCharge = 0;

  if (deliveryType === "Delivery" && vendorId) {
    deliveryCharge = await getDeliveryCharge(
      userId,
      vendorId,
      totalWeight,
      selectedAddressId
    );
  }

  /** ---- Final Totals ---- */
  const finalTotal =
    totalMRP - totalDiscount + (deliveryType === "Pickup" ? 0 : deliveryCharge);

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
