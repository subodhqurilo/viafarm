const express = require('express');
const { getDeliveryCharge } = require('../utils/orderUtils');
const router = express.Router();

// ✅ TEST API — Directly test delivery charge
router.get('/test/delivery-charge', async (req, res) => {
  try {
    const buyerId = req.query.buyerId;
    const vendorId = req.query.vendorId;

    if (!buyerId || !vendorId) {
      return res.status(400).json({ success: false, message: 'buyerId and vendorId are required' });
    }

    const charge = await getDeliveryCharge(buyerId, vendorId, 2);
    res.json({ success: true, deliveryCharge: charge });
  } catch (err) {
    console.error('Error testing delivery charge:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
