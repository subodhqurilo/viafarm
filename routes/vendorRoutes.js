const express = require('express');
const router = express.Router();
const multer = require('multer');

const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');
const vendorController = require('../controllers/vendorController');
const { upload, cloudinary } = require('../services/cloudinaryService');

// -------------------------
// Protect all vendor routes
// -------------------------
router.use(authMiddleware);

// -------------------------
// Coupons (Vendor can see all their coupons)
// -------------------------
router.get('/coupons', vendorController.getVendorCoupons);              // Get all coupons
router.get('/coupons/:id', vendorController.getVendorCouponById);       // Get single coupon
router.post('/coupons/create', vendorController.createCoupon);          // Create coupon
router.put('/coupons/:id', vendorController.updateVendorCoupon);        // Update coupon
router.delete('/coupons/:id', vendorController.deleteVendorCoupon);     // Delete coupon

// -------------------------
// Product Routes
// -------------------------
router.get('/products', vendorController.getVendorProducts);
router.get('/products/:id', vendorController.getProductById);
router.post('/products/add', upload.array('images', 5), vendorController.addProduct);
router.put('/products/:id', upload.array('images', 5), vendorController.updateProduct);
router.delete('/products/:id', vendorController.deleteProduct);
router.put('/products/:id/status', vendorController.updateProductStatus);
router.get("/public/products/:category", vendorController.getVendorProductsByCategory);

// -------------------------
// Orders
// -------------------------
router.put('/orders/:id/update-status', vendorController.updateOrderStatus);

router.get('/orders', vendorController.getVendorOrders);


router.get('/orders/stats', vendorController.getVendorOrderStats);
router.get('/orders/monthly', vendorController.getMonthlyOrders);
router.get('/orders/recent', vendorController.getRecentVendorOrders);
router.get('/orders/today', vendorController.getTodaysOrders);

// -------------------------
// Dashboard
// -------------------------
router.get('/dashboard', vendorController.getDashboardData);
router.get('/dashboard-analytics', vendorController.getVendorDashboardAnalytics);
router.get('/recent-products', vendorController.getRecentListings); // Vendor-only recent products

// -------------------------
// Vendor Profile & Settings
// -------------------------
router.get('/profile', vendorController.getUserProfile);
router.put(
    '/profile',
    upload.fields([
        { name: 'profilePicture', maxCount: 1 },
        { name: 'farmImages', maxCount: 5 }, // you can change 5 → any number
    ]),
    vendorController.updateUserProfile
);
router.put('/update-language', vendorController.updateUserLanguage);
router.put('/update-location', vendorController.updateLocationDetails);
router.get('/update-location', vendorController.getVendorLocationDetails);

router.post('/change-password', vendorController.changePassword);
router.post('/logout', vendorController.logout);
router.put('/updatestatus', vendorController.updateUserStatus);

// -------------------------
// Role-based protection (Vendor only routes)
// -------------------------
router.use(authorizeRoles('Vendor'));

module.exports = router;
