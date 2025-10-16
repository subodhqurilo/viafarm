// utils/orderUtils.js
const Coupon = require('../models/Coupon');
const mongoose = require('mongoose'); // Assuming mongoose is needed for Coupon model

async function calculateOrderSummary(cartOrItems, couponCode) {
    const items = Array.isArray(cartOrItems) ? cartOrItems : (cartOrItems?.items || []);

    let totalMRP = 0;
    let totalDiscount = 0;

    const updatedItems = [];

    // Fetch coupon details
    const coupon = couponCode
        ? await Coupon.findOne({ code: couponCode.toUpperCase(), status: 'Active' })
        : null;

    for (const item of items) {
        // Fallback for price: prefer price snapshot on item, then populated product price, then 0
        const price = (typeof item.price === 'number' && !Number.isNaN(item.price))
            ? item.price
            : (item.product?.price || 0);

        const qty = Number(item.quantity) || 0;
        const itemMRP = price * qty;

        let itemDiscount = 0;

        // Apply coupon only if applicable
        if (coupon) {
            // Get vendor ID from item snapshot or populated product
            const productVendorId = item.vendor?.toString() || item.product?.vendor?.toString(); 
            
            // Assuming Coupon model has a 'vendor' field linking to the creator
            if (productVendorId && productVendorId === coupon.vendor.toString()) { 
                if (coupon.discount.type === 'Percentage') {
                    itemDiscount = (itemMRP * coupon.discount.value) / 100;
                } else if (coupon.discount.type === 'Fixed') {
                    // Apply fixed discount entirely to the first applicable item or split logic if necessary
                    // For simplicity, applying fixed discount once if totalDiscount is still zero
                    if (totalDiscount === 0) {
                        itemDiscount = coupon.discount.value;
                    }
                }
            }
        }

        totalMRP += itemMRP;
        totalDiscount += itemDiscount;

        updatedItems.push({
            // Ensure data integrity when converting back from lean/populated objects
            ...item.toObject?.() || item, 
            itemMRP: parseFloat(itemMRP.toFixed(2)),
            discount: parseFloat(itemDiscount.toFixed(2)),
            total: parseFloat((itemMRP - itemDiscount).toFixed(2))
        });
    }

    // 🚨 UPDATED LOGIC: Delivery Charge is 0 if totalMRP > 500, otherwise 20.
    const deliveryCharge = totalMRP > 500 ? 0 : 20; // <--- CHANGE APPLIED HERE
    const finalTotalAmount = totalMRP - totalDiscount + deliveryCharge; 

    return {
        items: updatedItems,
        summary: {
            totalMRP: parseFloat(totalMRP.toFixed(2)),
            discount: parseFloat(totalDiscount.toFixed(2)),
            deliveryCharge: parseFloat(deliveryCharge.toFixed(2)),
            totalAmount: parseFloat(finalTotalAmount.toFixed(2))
        }
    };
}

module.exports = { calculateOrderSummary };