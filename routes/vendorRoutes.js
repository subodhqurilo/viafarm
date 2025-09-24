const express = require('express');
const router = express.Router();

const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');
const vendorController = require('../controllers/vendorController');
const { upload } = require('../services/cloudinaryService');

// -------------------------
// Protect all vendor routes
// -------------------------
router.use(authMiddleware);
router.use(authorizeRoles('vendor'));

// -------------------------
// Dashboard & Analytics
// -------------------------
router.get('/dashboard', vendorController.getDashboardData);

// -------------------------
// Product Management
// -------------------------
router.post(
  '/products',
  upload.array('images', 5), // max 5 images
  vendorController.addProduct
);
router.get('/products', vendorController.getVendorProducts);
router.put(
  '/products/:id',
  upload.array('images', 5),
  vendorController.updateProduct
);
router.delete('/products/:id', vendorController.deleteProduct);

// -------------------------
// Order Management
// -------------------------
router.get('/orders', vendorController.getVendorOrders);
router.put('/orders/:id/status', vendorController.updateOrderStatus); // optional: update status route

// -------------------------
// Profile Management
// -------------------------
router.get('/profile', vendorController.getProfile);
router.put('/profile', vendorController.updateProfile);

module.exports = router;
