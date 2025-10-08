const express = require('express');
const asyncHandler = require('express-async-handler');

const router = express.Router();
const adminController = require('../controllers/adminController');
const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../services/cloudinaryService');

// -------------------------
// Public routes
// -------------------------
router.get('/manage-app/coupons', adminController.getAdminCoupons);

router.get('/manage-app/categories', adminController.getCategories);
router.get('/manage-app/categories/:id', adminController.getCategoryById);
router.get('/manage-app/customer-support', adminController.getCustomerSupportDetails);
router.get('/manage-app/:pageName', asyncHandler(adminController.getStaticPageContent));


// -------------------------
// Protected routes
// -------------------------
router.use(authMiddleware); // All routes below require authentication

// Vendors & Buyers
router.get('/vendors', adminController.getVendors);
router.get('/vendor/:id', adminController.getVendorDetails);
router.get('/buyers', adminController.getBuyers);
router.get('/buyer/:id', adminController.getBuyerDetails);

// Banners & Pages
router.get('/public/manage-app/banners', adminController.getBanners);
router.get('/manage-app/:pageName', adminController.getStaticPageContent);
// User Notification Settings (New Routes)
router.get('/settings/user-notifications', adminController.getuserNotificationSettings);
router.put('/settings/user-notifications', adminController.updateuserNotificationSettings);

// -------------------------
// Admin-only routes
// -------------------------
router.use(authorizeRoles('Admin'));
router.put('/manage-app/customer-support', adminController.updateCustomerSupportDetails);
router.put(
  '/manage-app/:pageName',
  authMiddleware,
  authorizeRoles('Admin'),
  asyncHandler(adminController.updateStaticPageContent)
);

// Dashboard
router.get('/dashboard', adminController.getDashboardStats);
router.get('/recent-activity', adminController.getRecentActivity);

// Product Management
router.get('/products', adminController.getProducts);
router.get('/products/:id', adminController.getAdminProductDetails);
router.put('/products/:id/nutritional-value', adminController.addOrUpdateNutritionalValue);
router.delete('/products/:id', adminController.deleteProduct);

// Vendor Management
router.put('/vendors/:id/status', adminController.updateVendorStatus);
router.delete('/vendors/:id', adminController.deleteVendor); // soft-delete

// Buyer Management
router.put('/buyers/:id/block', adminController.blockBuyer);
router.delete('/users/:id', adminController.deleteBuyer);

// Order Management
router.get('/orders', adminController.getOrders);
router.get('/orders/:id', adminController.getOrderDetail);
router.delete('/orders/:id', adminController.deleteOrder);

// Manage Banners
router.post('/manage-app/banners', upload.array('images', 5), adminController.createBanner);
router.delete('/manage-app/banners/:id', adminController.deleteBanner);

// Manage Categories
router.post('/manage-app/categories', upload.single('image'), adminController.createCategory);
router.put('/manage-app/categories/:id', upload.single('image'), adminController.updateCategory);
router.delete('/manage-app/categories/:id', adminController.deleteCategory);

// Coupons

router.post('/manage-app/coupons', adminController.createCoupon);
router.put('/manage-app/coupons/:id', adminController.updateCoupon);
router.delete('/manage-app/coupons/:id', adminController.deleteCoupon);

// Static Pages
router.put('/manage-app/:pageName', adminController.updatePageContent);
router.post('/manage-app/pages', adminController.postPageContent);

// Settings
router.get('/settings/profile', adminController.getAdminProfile);
router.put('/settings/profile', upload.single('profilePicture'), adminController.updateAdminProfile);
router.delete('/settings/profile-picture', adminController.deleteAdminProfilePicture);
router.post('/settings/change-password', adminController.changeAdminPassword);
router.get('/settings/notifications', adminController.getNotificationSettings);
router.put('/settings/notifications', adminController.updateNotificationSettings);

module.exports = router;
