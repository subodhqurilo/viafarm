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
   startCheckout,getHighlightedCoupon,getPickupLocationDetails,selectPickupSlot,
verifyPayment,getProductsByCategory,getVendorProfileForBuyer,getProductReviews,getAvailableCouponsForBuyer,getCouponsByProductId,
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

router.get('/products/by-category', getProductsByCategory);
router.get('/products/:id', getProductDetails);
// Vendor Details
router.get('/vendor/:vendorId', getVendorProfileForBuyer);
router.get('/products/:productId/reviews', getProductReviews);


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
router.get('/coupons/available', getAvailableCouponsForBuyer);
router.get('/coupons/product/:productId', getCouponsByProductId);
router.get('/coupons/highlighted', getHighlightedCoupon);

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
router.get('/pickup/:vendorId',  getPickupLocationDetails);
router.post("/pickup-slot/select",  selectPickupSlot);


// Profile & Settings
router.route('/profile')
    .get(getBuyerProfile) // GET /api/buyer/profile (This is the route for getBuyerProfile)
    .put(upload.single('profilePicture'), updateBuyerProfile);
router.put('/location', updateBuyerLocation);
router.put('/language', updateBuyerLanguage);
// router.post('/logout', authMiddleware, authorizeRoles('Buyer'), buyerController.logout);

module.exports = router;
