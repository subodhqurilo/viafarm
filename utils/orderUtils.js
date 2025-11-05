// utils/orderUtils.js
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const Address = require('../models/Address');

/**
 * --- Helper: Haversine formula (in km) ---
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
 * --- Delivery charge calculator ---
 */
async function getDeliveryCharge(buyerId, vendorId, totalWeightKg = 1) {
    try {
        const [buyerAddress, vendor] = await Promise.all([
            Address.findOne({ user: buyerId, isDefault: true }).lean(),
            User.findById(vendorId).lean(),
        ]);

        if (!vendor?.location?.coordinates || !buyerAddress?.location?.coordinates) return 20;

        const [buyerLng, buyerLat] = buyerAddress.location.coordinates;
        const [vendorLng, vendorLat] = vendor.location.coordinates;

        const distanceKm = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);

        const deliveryRegion = vendor.deliveryRegion || 5;
        let charge = 0;

        if (distanceKm <= deliveryRegion) {
            charge = distanceKm <= 2 ? 50 : 50 + (distanceKm - 2) * 10;
        } else {
            const sameState = buyerAddress?.state?.trim()?.toLowerCase() === vendor?.state?.trim()?.toLowerCase();
            charge = sameState ? 60 + Math.max(0, totalWeightKg - 2) * 20 : 80 + Math.max(0, totalWeightKg - 2) * 25;
        }

        return parseFloat(charge.toFixed(2));
    } catch (err) {
        return 20;
    }
}

/**
 * --- Main order summary calculator ---
 */
async function calculateOrderSummary(cartOrItems, couponCode, deliveryType = 'Delivery') {
    const items = Array.isArray(cartOrItems) ? cartOrItems : cartOrItems?.items || [];

    let totalMRP = 0;
    let totalDiscount = 0;
    let totalWeight = 0;
    const updatedItems = [];

    const coupon = couponCode
        ? await Coupon.findOne({ code: couponCode.toUpperCase(), status: 'Active' })
        : null;

    for (const item of items) {
        const price = typeof item.price === 'number' ? item.price : item.product?.price || 0;
        const qty = Number(item.quantity) || 0;
        const itemMRP = price * qty;
        totalMRP += itemMRP;
        totalWeight += (item.product?.weightPerPiece || 0.2) * qty;

        let itemDiscount = 0;

        if (coupon) {
            // Apply to all products or specific products
            if (
                coupon.appliesTo.includes('All Products') ||
                (item.product?._id && coupon.applicableProducts?.some(p => p.equals(item.product._id)))
            ) {
                if (coupon.discount.type === 'Percentage') {
                    itemDiscount = (itemMRP * coupon.discount.value) / 100;
                } else if (coupon.discount.type === 'Fixed') {
                    // Spread fixed discount proportionally
                    const totalQualifyingMRP = items.reduce((sum, i) => {
                        if (
                            coupon.appliesTo.includes('All Products') ||
                            coupon.applicableProducts?.some(p => p.equals(i.product?._id))
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
    if (deliveryType === 'Delivery' && vendorId) {
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
