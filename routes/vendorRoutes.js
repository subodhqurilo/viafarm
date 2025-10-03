const express = require('express');
const router = express.Router();
const multer = require('multer');

const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');
const vendorController = require('../controllers/vendorController');
const { upload,cloudinary } = require('../services/cloudinaryService');

// -------------------------
// Protect all vendor routes
// -------------------------
router.use(authMiddleware);
router.get('/coupons', vendorController.getVendorCoupons);              // Get all coupons
router.get('/coupons/:id', vendorController.getVendorCouponById);       // Get single coupon

router.get('/products/:id', vendorController.getProductById);                 // dynamic





router.use(authorizeRoles('Vendor'));

// -------------------------
// Dashboard
// -------------------------
router.get('/dashboard', vendorController.getDashboardData);
router.get('/orders/monthly', vendorController.getMonthlyOrders );
router.get('/orders/recent', vendorController.getRecentVendorOrders  );
router.get('/orders/today', vendorController.getTodaysOrders );

// -------------------------
// Product Management
// -------------------------
router.get('/recent-products', vendorController.getRecentListings); // now vendor-only
router.get('/products', vendorController.getVendorProducts);

router.post('/products/add', upload.array('images', 5), vendorController.addProduct);

router.put(
  '/products/:id',
  upload.array('images', 5), // max 5 images
  vendorController.updateProduct
);


router.delete('/products/:id', vendorController.deleteProduct);
router.put('/products/:id/status', vendorController.updateProductStatus);

// -------------------------
// Order Management
// -------------------------
router.get('/orders', vendorController.getVendorOrders);
router.put('/orders/:id/update-status', vendorController.updateOrderStatus);

// -------------------------
// Coupon Management
// -------------------------
router.get('/coupons/:id', vendorController.getVendorCouponById);       // Get single coupon
router.post('/coupons/create', vendorController.createCoupon);          // Create coupon
router.put('/coupons/:id', vendorController.updateVendorCoupon);        // Update coupon
router.delete('/coupons/:id', vendorController.deleteVendorCoupon);
// -------------------------
// Vendor Profile & Settings
// -------------------------
// Vendor Profile & Settings
// -------------------------
router.get('/profile', vendorController.getUserProfile);                  // Get vendor profile

router.put('/profile', upload.single('profilePicture'), vendorController.updateUserProfile);

router.put('/update-language', vendorController.updateUserLanguage);
router.put('/update-location', vendorController.updateUserLocation);

router.post('/change-password', vendorController.changePassword);     // Change password
router.post('/logout', vendorController.logout);                       // Logout

module.exports = router;
