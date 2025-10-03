const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');
const multer = require('multer');

const buyerController = require('../controllers/buyerController');
const { 
    getBuyerProfile, updateBuyerProfile, updateBuyerLocation, updateBuyerLanguage, getWishlist, addToWishlist, getBuyerOrders, removeFromWishlist,reportBuyerIssue,
    getStaticPageContent ,writeReview ,getCartItems, addItemToCart,removeItemFromCart,updateCartItemQuantity,placeOrder,
reorder,
getReviewsForProduct,
 updateReview,
  deleteReview,
applyCouponToCart,
    getOrderDetails, 
   startCheckout,
verifyPayment,
addAddress,getFreshAndPopularProducts ,getLocalBestProducts,getAllAroundIndiaProducts,getSmartPicks,
getAddresses,setDefaultAddress,getHomePageData,getProductDetails,getFilteredProducts,getVendorsNearYou,searchProducts,generateUpiPaymentUrl
} = require('../controllers/buyerController');


const { upload } = require('../services/cloudinaryService');


router.use(authMiddleware);
router.use(authorizeRoles('Buyer'));
// --- Public Routes ---
// Buyer role check -> authorizeRoles('buyer')
router.get('/home',   getHomePageData);
router.get('/products/filters', getFilteredProducts);
router.get('/products/search', searchProducts); 
router.get('/products/:id', getProductDetails);
router.get('/fresh-and-popular', getFreshAndPopularProducts);
router.get('/local-best', getLocalBestProducts);
router.get('/all-around-india', getAllAroundIndiaProducts);
router.get('/smart-picks', getSmartPicks);

router.get('/public/static-page/:pageName', getStaticPageContent); 


router.get('/vendors-near-you',  getVendorsNearYou);

// Cart, Checkout & Orders
router.get('/cart', getCartItems);
router.post('/cart/add', addItemToCart);
router.delete('/cart/:id', removeItemFromCart);
router.put('/cart/:id/quantity', updateCartItemQuantity);
router.post('/orders/place', placeOrder);
router.get('/orders', getBuyerOrders);
router.get('/orders/:orderId', getOrderDetails);
router.post('/orders/:orderId/reorder', reorder);
router.post('/cart/apply-coupon', applyCouponToCart); 
router.get('/checkout',  startCheckout);
router.post('/orders/verify-payment', verifyPayment);
// Generate UPI payment URL
router.post('/upi-url', generateUpiPaymentUrl);


// Wishlist
router.get('/wishlist',   getWishlist);
router.post('/wishlist/add', addToWishlist);
router.delete('/wishlist/:id', removeFromWishlist);

// Reviews
router.post('/reviews/:productId', upload.array('images', 5), writeReview);
router.get('/reviews/:productId', getReviewsForProduct);
router.put('/reviews/:reviewId', authMiddleware, upload.array('images', 5), updateReview);
router.delete('/reviews/:reviewId', authMiddleware, deleteReview);


router.post('/addresses', addAddress);


router.get('/addresses', getAddresses);


router.put('/addresses/:id/default', setDefaultAddress);


// Profile & Settings
router.route('/profile')
    .get(getBuyerProfile) // GET /api/buyer/profile (This is the route for getBuyerProfile)
    .put(upload.single('profilePicture'), updateBuyerProfile);
router.put('/location', updateBuyerLocation);
router.put('/language', updateBuyerLanguage);
// router.post('/logout', authMiddleware, authorizeRoles('Buyer'), buyerController.logout);

module.exports = router;
