// routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware'); // ✅ correct import
const adminController = require('../controllers/adminController');
const { upload } = require('../services/cloudinaryService');

// All admin routes are protected
router.use(authMiddleware);
router.use(authorizeRoles('admin')); // ✅ this works

// --- User Management Routes ---
router.get('/users', adminController.getAllUsers);
router.put('/users/role', adminController.updateUserRole);

// --- Product and Order Management Routes ---
router.get('/products', adminController.getAllProducts);
router.get('/orders', adminController.getAllOrders);

// --- Banner Management Routes ---
router.post('/banners', upload.single('bannerImage'), adminController.addBanner);
router.get('/banners', adminController.getAllBanners);
router.put('/banners/:id', upload.single('bannerImage'), adminController.updateBanner);
router.delete('/banners/:id', adminController.deleteBanner);

// --- Category Management Routes ---
router.post('/categories', adminController.addCategory);
router.get('/categories', adminController.getCategories);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

module.exports = router;
