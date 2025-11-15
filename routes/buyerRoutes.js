const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/authMiddleware');

// Get all exported controllers from the buyerController file
const { 
    getBuyerProfile, updateBuyerProfile, updateBuyerLocation, updateBuyerLanguage, getWishlist, addToWishlist, getBuyerOrders, removeFromWishlist, getProductsByVariety ,
    getStaticPageContent, writeReview, getCartItems, addItemToCart, removeItemFromCart, updateCartItemQuantity, placeOrder,updateAddress,deleteAddress,
    reorder, getReviewsForProduct, updateReview, deleteReview, applyCouponToCart,getAllVendors,searchAllProducts,getProductsByVendorId,getProductById,
    getOrderDetails, startCheckout, getHighlightedCoupon, getPickupLocationDetails, selectPickupSlot,getProductsByName,getPickupLocationDetailsPost,getCategoriesWithProducts,
    verifyPayment, getProductsByCategory, getVendorProfileForBuyer, getProductReviews, getAvailableCouponsForBuyer, getCouponsByProductId,getDonationsReceived,
    addAddress, getFreshAndPopularProducts, getLocalBestProducts, getAllAroundIndiaProducts, getSmartPicks,getVendorsByProductName,donateToAdmin,searchProductsByName,
    getAddresses, setDefaultAddress, getHomePageData, getProductDetails, getFilteredProducts, getVendorsNearYou, searchProducts, generateUpiPaymentUrl,markOrderPaid
} = require('../controllers/buyerController');

const { upload } = require('../services/cloudinaryService');


router.get('/products/search', searchProducts); 
router.get('/donation', getDonationsReceived);

router.use(authMiddleware); 
router.get('/local-best', getLocalBestProducts); 

// ---------------------------------------------------------------------
// 2. BUYER AUTHORIZED ROUTES 

router.use(authorizeRoles('Buyer'));


router.get('/home', getHomePageData);
router.get('/products/filters', getFilteredProducts);
router.get('/products/by-category', getProductsByCategory);
router.get('/products/variety', getProductsByVariety );

router.get('/products/search', searchProductsByName);
router.get('/vendors-near-you', getVendorsNearYou);
router.get('/allvendors', getAllVendors);
router.get('/vendors/by-product', getVendorsByProductName);
router.get('/products/all', searchAllProducts); // <-- ADD THIS LINE
router.get('/products/by-name', getProductsByName);
router.get('/vendor/:vendorId/products', getProductsByVendorId);
router.get('/public/product/:id', getProductById);
router.get('/products/:id', getProductDetails); // Path clearer

router.get('/fresh-and-popular', getFreshAndPopularProducts);
router.get('/all-around-india', getAllAroundIndiaProducts);
router.get('/smart-picks', getSmartPicks);

router.get('/vendor/:vendorId', getVendorProfileForBuyer);

// Static Pages (Auth & Buyer Role required)
router.get('/static-page/:pageName', getStaticPageContent); 


// --- Cart, Checkout & Orders ---
router.get('/cart', getCartItems);
router.post('/cart/add', addItemToCart);
router.delete('/cart/:id', removeItemFromCart);
router.put('/cart/:id/quantity', updateCartItemQuantity);
router.post('/cart/apply-coupon', applyCouponToCart); 

router.get('/checkout', startCheckout);
router.post('/orders/place', placeOrder);
router.get('/orders', getBuyerOrders);
router.get('/orders/:orderId', getOrderDetails);
router.post('/orders/:orderId/reorder', reorder);
router.post('/orders/verify-payment', verifyPayment);
router.put('/:orderId/mark-paid',  markOrderPaid);

// Payment & Coupon
router.post('/payment/upi-url', generateUpiPaymentUrl); 
router.get('/coupons/available', getAvailableCouponsForBuyer);
router.get('/coupons/product/:productId', getCouponsByProductId);
router.get('/coupons/highlighted', getHighlightedCoupon);

// --- Wishlist (RESTful path) ---
router.get('/wishlist', getWishlist);
router.post('/wishlist/add', addToWishlist); 
router.delete('/wishlist/:productId', removeFromWishlist); 

// --- Reviews ---
router.get('/reviews/product/:productId', getReviewsForProduct); // Path clearer
router.get('/products/:productId/reviews', getProductReviews);


router.post('/reviews/:productId', upload.array('images', 5), writeReview); 
router.put('/reviews/:reviewId', upload.array('images', 5), updateReview); // Removed redundant authMiddleware
router.delete('/reviews/:reviewId', deleteReview); // Removed redundant authMiddleware

router.get('/with-products', getCategoriesWithProducts);


// --- Address & Pickup ---
router.get('/addresses', getAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:id', updateAddress);  // Update address by ID (supports 'profile' or normal address)
router.delete('/addresses/:id',  deleteAddress); // ✅ DELETE route

router.put('/addresses/:id/default', setDefaultAddress);

router.get('/pickup/:vendorId/pickup-details', getPickupLocationDetails);
router.post('/pickup/location', getPickupLocationDetailsPost); // ✅ new POST version

router.post("/pickup-slot/select", selectPickupSlot);


// --- Profile & Settings ---
router.route('/profile')
    .get(getBuyerProfile)
    .put(upload.single('profilePicture'), updateBuyerProfile);

router.put('/location', updateBuyerLocation);
router.put('/language', updateBuyerLanguage);
router.post('/donation', donateToAdmin);


module.exports = router;