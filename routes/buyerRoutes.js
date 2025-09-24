const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const buyerController = require('../controllers/buyerController');

// --- Public Routes ---
router.get('/', buyerController.getHomeScreenData);
router.get('/products/:id', buyerController.getProductDetails);

// --- Protected Routes (require authentication) ---
router.use(authMiddleware);

// Cart and order routes
router.post('/cart/add', buyerController.addItemToCart);
router.get('/cart', buyerController.getCartItems);
router.delete('/cart/remove/:productId', buyerController.removeItemFromCart);
router.post('/orders', buyerController.createOrder);
router.get('/orders', buyerController.getOrders);

// Profile routes
router.get('/profile', buyerController.getProfile);
router.put('/profile', buyerController.updateProfile);

// Address routes
router.post('/address', buyerController.addAddress);
router.get('/address', buyerController.getAddresses);

// Wishlist routes
router.post('/wishlist', buyerController.addToWishlist);
router.get('/wishlist', buyerController.getWishlist);

module.exports = router;
