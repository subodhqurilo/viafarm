// utils/orderUtils.js
const Coupon = require('../models/Coupon');

async function calculateOrderSummary(cartOrItems, couponCode) {
  // Accept either cart or items array
  const items = Array.isArray(cartOrItems) ? cartOrItems : (cartOrItems?.items || []);

  let totalMRP = 0;

  for (const item of items) {
    // Prefer item.price (snapshot) if present, else use populated product price
    const price = (typeof item.price === 'number' && !Number.isNaN(item.price))
      ? item.price
      : (item.product?.price || 0);

    const qty = Number(item.quantity) || 0;
    totalMRP += price * qty;
  }

  let discount = 0;
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode, status: 'Active' });
    if (coupon) {
      if (coupon.type === 'percentage') discount = (totalMRP * coupon.value) / 100;
      else if (coupon.type === 'flat') discount = coupon.value;
    }
  }

  const deliveryCharge = totalMRP > 1000 ? 0 : 20;
  const totalAmount = totalMRP - discount + deliveryCharge;

  return {
    totalMRP,
    discount,
    deliveryCharge,
    totalAmount,
  };
}

module.exports = { calculateOrderSummary };
