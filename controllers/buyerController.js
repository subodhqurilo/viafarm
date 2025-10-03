// controllers/buyerController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const Wishlist = require('../models/Wishlist');
const Address = require('../models/Address');
const Review = require('../models/Review');
const { upload, cloudinary } = require('../services/cloudinaryService');
const Coupon = require('../models/Coupon');
const { calculateOrderSummary } = require('../utils/orderUtils');

// -----------------------------
// Home & Product Discovery
// -----------------------------

// @desc    Get buyer home screen data
// @route   GET /api/buyer/home
// @access  Private/Buyer

// Add this at the top or above your controller function
const generateUpiUrl = (upiId, name, amount, orderId) => {
    const payeeVpa = encodeURIComponent(upiId);
    const payeeName = encodeURIComponent(name);
    const transactionNote = encodeURIComponent(`Payment for Order ID(s): ${orderId}`);
    const encodedAmount = encodeURIComponent(amount.toFixed(2));

    return `upi://pay?pa=${payeeVpa}&pn=${payeeName}&am=${encodedAmount}&tn=${transactionNote}&cu=INR`;
};

const getHomePageData = asyncHandler(async (req, res) => {
    const categories = await Product.distinct('category');
    const popularProducts = await Product.find({ status: 'In Stock' }).sort({ rating: -1 }).limit(10).populate('vendor', 'name');
    const vendors = await User.find({ role: 'Vendor', status: 'Active' }).limit(5);

    res.json({ success: true, data: { categories, popularProducts, vendors } });
});


const searchProducts = asyncHandler(async (req, res) => {
    const { q } = req.query;

    if (!q || q.trim() === '') {
        return res.status(400).json({ success: false, message: 'Search query is required.' });
    }

    const products = await Product.find(
        { $text: { $search: q }, status: 'In Stock' },
        { score: { $meta: 'textScore' } }
    )
    .sort({ score: { $meta: 'textScore' } })
    .populate('vendor', 'name');

    if (products.length === 0) {
        return res.status(404).json({ success: false, message: 'No products found matching your search.' });
    }

    res.status(200).json({ success: true, count: products.length, data: products });
});


const getFilteredProducts = asyncHandler(async (req, res) => {
    const { category, vendor, minPrice, maxPrice, status } = req.query;

    // Build filter object dynamically
    const filter = {};

    if (category) filter.category = category;
    if (vendor) filter.vendor = vendor;
    if (status) filter.status = status;
    if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = Number(minPrice);
        if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const products = await Product.find(filter)
        .populate('vendor', 'name mobileNumber')  // populate vendor info
        .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: products });
});

// @desc    Get detailed product view
// @route   GET /api/buyer/products/:id
// @access  Private/Buyer
const getProductDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check for valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    // Find product by ID and populate vendor details
    const product = await Product.findById(id)
        .populate('vendor', 'name address mobileNumber');

    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // Fetch reviews
    const reviews = await Review.find({ product: id })
        .populate('user', 'name profileImage')
        .sort({ createdAt: -1 });

    res.status(200).json({ success: true, product, reviews });
});


const getFreshAndPopularProducts = asyncHandler(async (req, res) => {
    try {
        const products = await Product.find({ status: 'In Stock' })
            .sort({ rating: -1, createdAt: -1 }) // Popular first, then fresh
            .limit(10) // Limit to 10 results
            .populate('vendor', 'name'); // Show vendor name

        res.status(200).json({
            success: true,
            data: products
        });
    } catch (error) {
        console.error("Error fetching fresh & popular products:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch fresh and popular products"
        });
    }
});

const getLocalBestProducts = asyncHandler(async (req, res) => {
    const { lat, lng, maxDistance = 10000 } = req.query; // default 10km

    if (!lat || !lng) {
        // ✅ fallback if location not provided
        const fallbackProducts = await Product.find({ status: 'In Stock' })
            .sort({ rating: -1 })
            .limit(10)
            .populate('vendor', 'name');

        return res.status(200).json({
            success: true,
            message: "Location not provided, showing popular products from all vendors.",
            data: fallbackProducts
        });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ success: false, message: "Invalid latitude or longitude." });
    }

    try {
        // ✅ Find vendors near the given lat/lng
        const localVendors = await User.find({
            role: "Vendor",
            status: "Active",
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude]
                    },
                    $maxDistance: parseInt(maxDistance)
                }
            }
        }).select('_id');

        const vendorIds = localVendors.map(vendor => vendor._id);

        if (vendorIds.length === 0) {
            return res.status(404).json({ success: false, message: "No local vendors found in your area." });
        }

        // ✅ Get top-rated products from those vendors
        const localBestProducts = await Product.find({
            vendor: { $in: vendorIds },
            status: 'In Stock'
        })
        .sort({ rating: -1, createdAt: -1 })
        .limit(20)
        .populate('vendor', 'name');

        res.status(200).json({
            success: true,
            count: localBestProducts.length,
            data: localBestProducts
        });
    } catch (err) {
        console.error("Error fetching local best products:", err);
        res.status(500).json({ success: false, message: "Failed to fetch local products. Please check the GeoJSON index." });
    }
});

const getAllAroundIndiaProducts = asyncHandler(async (req, res) => {
    // Fetch popular products from all vendors across India
    const products = await Product.find({ status: 'In Stock' })
        .sort({ rating: -1, salesCount: -1 }) // Sort by rating first, then sales
        .limit(10)
        .populate('vendor', 'name'); // populate vendor details

    if (products.length === 0) {
        return res.status(404).json({
            success: false,
            message: 'No popular products found.'
        });
    }

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

const getSmartPicks = asyncHandler(async (req, res) => {
    const { category, limit = 10 } = req.query;

    // Query filter
    const filter = { status: 'In Stock' };
    if (category) {
        filter.category = category;
    }

    const smartPicks = await Product.find(filter)
        .sort({ rating: -1, createdAt: -1 })
        .limit(parseInt(limit))
        .populate('vendor', 'name profilePicture');

    if (smartPicks.length === 0) {
        const message = category
            ? `No smart picks found for category: ${category}`
            : 'No smart picks found at this time.';
        return res.status(404).json({ success: false, message });
    }

    res.status(200).json({
        success: true,
        count: smartPicks.length,
        data: smartPicks
    });
});


const getStaticPageContent = asyncHandler(async (req, res) => {
    const page = await StaticPage.findOne({ pageName: req.params.pageName });
    if (!page) return res.status(404).json({ success: false, message: 'Page not found.' });
    res.status(200).json({ success: true, page });
});


// @desc    Get vendors near the user
// @route   GET /api/buyer/vendors/near-you
// @access  Private/Buyer
const getVendorsNearYou = asyncHandler(async (req, res) => {
    const { lat, lng, maxDistance = 5000 } = req.query; // maxDistance in meters

    if (!lat || !lng) {
        // Fallback or request location permission
        const vendors = await User.find({ role: 'Vendor', status: 'Active' }).limit(10).select('name profilePicture vendorDetails address');
        return res.status(200).json({ success: true, count: vendors.length, vendors, message: "Location not provided, showing random vendors." });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ success: false, message: "Invalid latitude or longitude." });
    }

    try {
        // IMPORTANT: The 'location' field in your User model must have a 2dsphere index.
        const vendors = await User.find({
            role: "Vendor",
            status: "Active",
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude] // [lng, lat]
                    },
                    $maxDistance: parseInt(maxDistance)
                }
            }
        }).select('name profilePicture upiId address location vendorDetails'); // Add fields needed for display

        res.status(200).json({
            success: true,
            count: vendors.length,
            vendors
        });
    } catch (err) {
        console.error("Error fetching nearby vendors:", err);
        // This usually happens if the 2dsphere index is missing
        res.status(500).json({ success: false, message: "Failed to fetch nearby vendors. Check GeoJSON index." });
    }
});



// -----------------------------
// Cart Management
// -----------------------------

// @desc    Get buyer's cart items
// @route   GET /api/buyer/cart
// @access  Private/Buyer
const getCartItems = asyncHandler(async (req, res) => {
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

    if (!cart) {
        return res.json({ success: true, data: { items: [], summary: { totalMRP: 0, discount: 0, deliveryCharge: 0, totalAmount: 0 } } });
    }

    const summary = await calculateOrderSummary(cart, cart.couponCode);

    res.json({ success: true, data: { items: cart.items, summary } });
});


// @desc    Add item to cart
// @route   POST /api/buyer/cart/add
// @access  Private/Buyer
// @desc    Add item to cart
// @route   POST /api/buyer/cart/add
// @access  Private/Buyer
// controllers/buyerController.js (only addItemToCart part)
const addItemToCart = asyncHandler(async (req, res) => {
    const { productId, quantity = 1 } = req.body;

    if (!productId || !quantity || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Product ID and valid quantity are required.' });
    }

    // find or create cart
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
        cart = await Cart.create({ user: req.user._id, items: [] });
    }

    // fetch product (ensure price & vendor)
    const product = await Product.findById(productId).select('price vendor status');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (product.status !== 'In Stock') {
        return res.status(400).json({ success: false, message: 'Product is out of stock.' });
    }

    // check existing item
    const itemIndex = cart.items.findIndex(i => i.product.toString() === productId);
    if (itemIndex > -1) {
        cart.items[itemIndex].quantity += Number(quantity);
        // optionally update price snapshot to current price (or keep old snapshot)
        cart.items[itemIndex].price = product.price;
    } else {
        cart.items.push({
            product: product._id,
            quantity: Number(quantity),
            vendor: product.vendor,
            price: product.price // snapshot price at add time
        });
    }

    // persist
    await cart.save();

    // populate for response and summary
    await cart.populate('items.product');

    const summary = await calculateOrderSummary(cart, cart.couponCode);

    res.status(200).json({ success: true, message: 'Item added to cart', data: { cart, summary } });
});






// @desc    Remove item from cart
// @route   DELETE /api/buyer/cart/:id
// @access  Private/Buyer
const removeItemFromCart = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    // Filter out the product
    const initialLength = cart.items.length;
    cart.items = cart.items.filter((i) => i.product._id.toString() !== id);

    if (cart.items.length === initialLength) {
        return res.status(404).json({ success: false, message: 'Item not found in cart' });
    }

    // Recalculate total
    cart.totalPrice = cart.items.reduce((t, i) => t + i.price * i.quantity, 0);

    await cart.save();

    res.json({ success: true, message: 'Item removed from cart', data: cart });
});


// @desc    Update cart item quantity
// @route   PUT /api/buyer/cart/:id/quantity
// @access  Private/Buyer
const updateCartItemQuantity = asyncHandler(async (req, res) => {
    const { quantity } = req.body;
    const { id } = req.params;

    if (!quantity || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Quantity must be at least 1.' });
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex((i) => i.product._id.toString() === id);
    if (itemIndex === -1) {
        return res.status(404).json({ success: false, message: 'Item not found in cart' });
    }

    cart.items[itemIndex].quantity = quantity;
    cart.totalPrice = cart.items.reduce((t, i) => t + i.price * i.quantity, 0);

    await cart.save();

    res.json({ success: true, message: 'Cart updated', data: cart });
});


// -----------------------------
// Orders
// -----------------------------

// @desc    Place an order
// @route   POST /api/buyer/orders/place
// @access  Private/Buyer



// @desc    Get all buyer's orders
// @route   GET /api/buyer/orders
// @access  Private/Buyer
// @desc    Re-order a past order
// @route   POST /api/buyer/orders/:orderId/reorder
// @access  Private/Buyer
const reorder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    // Find the old order
    const oldOrder = await Order.findOne({ _id: orderId, buyer: req.user._id });
    if (!oldOrder) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Create a new order with the same items
    const newOrder = await Order.create({
        orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`, // new unique orderId
        buyer: req.user._id,
        vendor: oldOrder.vendor,
        items: oldOrder.items,
        totalPrice: oldOrder.totalPrice,
        deliveryMethod: oldOrder.deliveryMethod,
        status: 'In Process',
    });

    res.status(201).json({
        success: true,
        message: 'Re-order placed successfully.',
        data: newOrder,
    });
});





const getBuyerOrders = asyncHandler(async (req, res) => {
    // 1. Fetch orders
    const orders = await Order.find({ buyer: req.user._id }).sort({ createdAt: -1 }).lean();

    // 2. Populate products and vendor manually
    const populatedOrders = await Promise.all(
        orders.map(async (order) => {
            const items = Array.isArray(order.items) ? await Promise.all(
                order.items.map(async (item) => {
                    if (!item || !item.product) return null;

                    const product = await Product.findById(item.product)
                        .select('name images price vendor')
                        .lean();
                    if (!product) return null;

                    const vendor = await User.findById(product.vendor)
                        .select('name address mobileNumber')
                        .lean();

                    return {
                        ...item,
                        product,
                        vendor
                    };
                })
            ) : [];

            return {
                ...order,
                items: items.filter(Boolean)
            };
        })
    );


    res.status(200).json({ success: true, orders: populatedOrders });
});





const getOrderDetails = asyncHandler(async (req, res) => {
    // 1. Find the order for the buyer
    const order = await Order.findOne({ _id: req.params.orderId, buyer: req.user._id }).lean();

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 2. Populate product and vendor for each item
    const populatedItems = await Promise.all(
        (order.items || []).map(async (item) => {
            if (!item.product) return null; // skip deleted products

            const product = await Product.findById(item.product)
                .select('name images price vendor')
                .lean();
            if (!product) return null;

            const vendor = await User.findById(product.vendor)
                .select('name address mobileNumber')
                .lean();

            return {
                ...item,
                product,
                vendor
            };
        })
    );

    // 3. Attach populated items to order
    const populatedOrder = {
        ...order,
        items: populatedItems.filter(Boolean)
    };

    res.status(200).json({ success: true, order: populatedOrder });
});



const applyCouponToCart = asyncHandler(async (req, res) => {
    const { code } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });
    const coupon = await Coupon.findOne({ code, status: 'Active' });

    if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found.' });
    }
    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Invalid or expired coupon.' });
    }

    const summary = await calculateOrderSummary(cart, code);

    if (summary.totalMRP < coupon.minimumOrder) {
        return res.status(400).json({ success: false, message: `Minimum order of ${coupon.minimumOrder} required.` });
    }

    cart.couponCode = code;
    await cart.save();

    res.status(200).json({ success: true, message: 'Coupon applied successfully.', summary });
});






// -----------------------------
// Wishlist
// -----------------------------


const getWishlist = asyncHandler(async (req, res) => {
    const wishlist = await Wishlist.findOne({ user: req.user._id }).populate('items.product');

    if (!wishlist) {
        return res.json({ success: true, data: { items: [] } });
    }

    const uniqueItems = [];
    const seen = new Set();

    for (const item of wishlist.items) {
        if (!item.product) continue; // ✅ skip null products
        const id = item.product._id.toString();
        if (!seen.has(id)) {
            uniqueItems.push(item);
            seen.add(id);
        }
    }

    res.json({ success: true, data: { ...wishlist.toObject(), items: uniqueItems } });
});




const addToWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.body;
    let wishlist = await Wishlist.findOne({ user: req.user._id });

    if (!wishlist) {
        wishlist = await Wishlist.create({ user: req.user._id, items: [] });
    }

    wishlist.items = wishlist.items || [];

    // Check if product already exists
    if (wishlist.items.some(item => item.product.toString() === productId)) {
        return res.status(400).json({ success: false, message: 'Already in wishlist' });
    }

    wishlist.items.push({ product: productId });
    await wishlist.save();

    res.json({ success: true, message: 'Added to wishlist', data: wishlist });
});




const removeFromWishlist = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) return res.status(404).json({ success: false, message: 'Wishlist not found' });

    // Filter out the product
    wishlist.items = wishlist.items.filter((item) => item.product.toString() !== id);

    await wishlist.save();
    res.json({ success: true, message: 'Removed from wishlist', data: wishlist });
});


// -----------------------------
// Reviews
// -----------------------------




const writeReview = asyncHandler(async (req, res) => {
    const { productId } = req.params; // ✅ from URL now
    const { rating, comment, orderId } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating is required (1-5).' });
    }

    // Fetch order
    const order = await Order.findById(orderId).populate('items.product');
    if (!order || order.buyer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to review this order.' });
    }

    // Ensure product exists in this order
    const productInOrder = order.items.find(
        (item) => item.product._id.toString() === productId.toString()
    );
    if (!productInOrder) {
        return res.status(400).json({ success: false, message: 'Product not found in this order.' });
    }

    // Handle image uploads if present
    const images = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'product-reviews' });
            images.push(result.secure_url);
        }
    }

    // Create review
    const review = await Review.create({
        product: productId,
        user: req.user._id,
        rating,
        comment,
        images,
        order: orderId,
        orderItem: `${orderId}-${productId}`, // unique per order-product
    });

    res.status(201).json({
        success: true,
        message: 'Review submitted successfully.',
        review
    });
});




// @desc    Get checkout data for the buyer
// @route   GET /api/buyer/checkout
// @access  Private/Buyer
// controllers/buyerController.js (replace startCheckout)
const startCheckout = asyncHandler(async (req, res) => {
    const userId = req.user._id || req.user.id;

    // 1. Fetch user
    const user = await User.findById(userId).select('name email mobileNumber profilePicture');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // 2. Fetch cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || !cart.items || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    // 3. Filter valid items
    const validItems = cart.items.filter(i => i.product);
    if (validItems.length === 0) return res.status(400).json({ success: false, message: 'No valid products in cart.' });

    // 4. Build items with stock info
    const itemsWithStockInfo = validItems.map(item => {
        const price = item.price || item.product.price || 0;
        const subtotal = price * (item.quantity || 0);
        const outOfStock = item.product.status !== 'In Stock';
        return {
            product: item.product,
            quantity: item.quantity,
            price,
            subtotal,
            outOfStock
        };
    });

    // 5. Calculate summary
    const itemsForSummary = validItems.map(i => ({
        product: i.product,
        quantity: i.quantity,
        price: i.price || i.product.price || 0
    }));
    const summary = await calculateOrderSummary(itemsForSummary, cart.couponCode);

    // 6. Addresses & coupons
    const addresses = await Address.find({ user: userId }).sort({ isDefault: -1 });
    const defaultAddress = addresses.find(a => a.isDefault) || null;
    const coupons = await Coupon.find({ status: 'Active' });

    // 7. Response
    res.status(200).json({
        success: true,
        message: 'Checkout data retrieved successfully.',
        data: {
            user: {
                _id: user._id,
                name: user.name,
                mobileNumber: user.mobileNumber,
                profilePicture: user.profilePicture
            },
            cart: {
                _id: cart._id,
                items: itemsWithStockInfo,
                couponCode: cart.couponCode,
                createdAt: cart.createdAt,
                updatedAt: cart.updatedAt
            },
            summary,
            addresses,
            defaultAddress,
            availableCoupons: coupons,
            payment: { upiId: '123c7ddr4s55fr@ybl' }
        }
    });
});


// @desc    Generate UPI payment URL
// @route   POST /api/buyer/upi-url
// @access  Private/Buyer
const generateUpiPaymentUrl = asyncHandler(async (req, res) => {
    const { upiId, name, amount, orderId } = req.body;

    if (!upiId || !name || !amount || !orderId) {
        return res.status(400).json({ success: false, message: 'All fields are required: upiId, name, amount, orderId.' });
    }

    const upiUrl = generateUpiUrl(upiId, name, amount, orderId);

    res.status(200).json({
        success: true,
        upiUrl
    });
});








// @desc    Place an order
// @route   POST /api/buyer/orders/place
// @access  Private/Buyer
const placeOrder = asyncHandler(async (req, res) => {
    const { shippingAddressId, pickupSlot, orderType, couponCode, comments, donation } = req.body;

    // 1. Validate orderType
    if (!orderType || !['Delivery', 'Pickup'].includes(orderType)) {
        return res.status(400).json({ success: false, message: 'Valid orderType is required (Delivery or Pickup).' });
    }

    // 2. Get cart and populate products
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || !cart.items || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }

    // 3. Filter valid items
    const validItems = cart.items.filter(i => i.product);
    if (validItems.length === 0) {
        return res.status(400).json({ success: false, message: 'Cart has no valid products.' });
    }

    // 4. Stock check
    for (const item of validItems) {
        if (item.product.status !== 'In Stock' || item.quantity > item.product.quantity) {
            return res.status(400).json({
                success: false,
                message: `Product "${item.product.name}" is out of stock or insufficient quantity.`
            });
        }
    }

    // 5. Handle shipping address for delivery
    let shippingAddress = null;
    if (orderType === 'Delivery') {
        if (!shippingAddressId) {
            return res.status(400).json({ success: false, message: 'Shipping address is required for delivery orders.' });
        }
        shippingAddress = await Address.findById(shippingAddressId);
        if (!shippingAddress) {
            return res.status(404).json({ success: false, message: 'Shipping address not found.' });
        }
    }

    // 6. Group items by vendor
    const ordersByVendor = {};
    validItems.forEach(item => {
        const vendorId = item.product.vendor?.toString();
        if (!vendorId) {
            console.error("⚠️ Product missing vendor:", item.product._id);
            return;
        }
        if (!ordersByVendor[vendorId]) ordersByVendor[vendorId] = [];
        ordersByVendor[vendorId].push(item);
    });

    // 7. Create orders per vendor
    const newOrders = [];
    for (const vendorId in ordersByVendor) {
        const vendorItems = ordersByVendor[vendorId];
        const summary = await calculateOrderSummary(vendorItems, couponCode);

        const orderProducts = vendorItems.map(item => ({
            product: item.product._id,
            quantity: item.quantity,
            price: item.product.price,
            vendor: item.product.vendor
        }));

        const newOrder = await Order.create({
    orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`, // unique ID
    buyer: req.user._id,
    vendor: vendorId,
    products: orderProducts,   // ✅ Correct field name
    totalPrice: summary.totalAmount,
    orderStatus: 'Pending',
    orderType,
    shippingAddress: shippingAddress || null,
    pickupSlot: orderType === 'Pickup' ? pickupSlot : null,
    comments: comments || '',
    donation: donation || 0
});


        newOrders.push(newOrder);

        // 8. Deduct stock for each product
        for (const item of vendorItems) {
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { quantity: -item.quantity }
            });
        }
    }

    // 9. Clear cart
    cart.items = [];
    cart.couponCode = undefined;
    await cart.save();

    // 10. Total payment
    const totalPaymentAmount = newOrders.reduce((acc, order) => acc + order.totalPrice, 0);

    res.status(201).json({
        success: true,
        message: 'Orders placed successfully. Awaiting payment verification.',
        orders: newOrders.map(o => ({
            orderId: o.orderId,
            vendor: o.vendor,
            totalPrice: o.totalPrice
        })),
        paymentDetails: {
            upiId: '123c7ddr4s55fr@ybl',
            amount: totalPaymentAmount
        }
    });
});








const verifyPayment = asyncHandler(async (req, res) => {
    const { orderIds, transactionId } = req.body; // accept array of orderIds

    if (!transactionId || transactionId.length <= 5) {
        return res.status(400).json({
            success: false,
            message: 'Invalid transaction ID.'
        });
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'orderIds array is required.'
        });
    }

    // Update all orders in a single query
    const result = await Order.updateMany(
        { orderId: { $in: orderIds } },
        { orderStatus: 'Confirmed', transactionId }
    );

    if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: 'No orders found with the given IDs.' });
    }

    res.status(200).json({
        success: true,
        message: 'Payment successfully done. Orders confirmed!',
        transactionId,
        confirmedOrdersCount: result.matchedCount
    });
});





// @desc    Get all reviews for a product
// @route   GET /api/buyer/reviews/:productId
// @access  Public
const getReviewsForProduct = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const reviews = await Review.find({ product: productId })
        .populate('user', 'name profileImage')
        .sort({ createdAt: -1 });

    res.status(200).json({ success: true, reviews });
});


// @desc    Update a review
// @route   PUT /api/buyer/reviews/:reviewId
// @access  Private/Buyer
const updateReview = asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { rating, comment } = req.body;

    const review = await Review.findById(reviewId);

    if (!review) {
        return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Only the owner can update
    if (review.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (rating) review.rating = rating;
    if (comment) review.comment = comment;

    // Handle images if uploaded
    if (req.files && req.files.length > 0) {
        const images = [];
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'product-reviews' });
            images.push(result.secure_url);
        }
        review.images = images;
    }

    const updatedReview = await review.save();
    res.status(200).json({ success: true, message: 'Review updated', review: updatedReview });
});

// @desc    Delete a review
// @route   DELETE /api/buyer/reviews/:reviewId
// @access  Private/Buyer
const deleteReview = asyncHandler(async (req, res) => {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
        return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Only the owner can delete
    if (review.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await review.remove();
    res.status(200).json({ success: true, message: 'Review deleted successfully' });
});



// -----------------------------
// Profile
// -----------------------------

const getBuyerProfile = asyncHandler(async (req, res) => {
    // Ensure the user is a Buyer, although the route middleware should handle this
    if (req.user.role !== 'Buyer') {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const user = await User.findById(req.user.id).select('-password');

    if (user) {
        res.status(200).json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                mobileNumber: user.mobileNumber,
                profilePicture: user.profilePicture,
                role: user.role,
                address: user.address,
                language: user.language
            }
        });
    } else {
        res.status(404).json({ success: false, message: 'Buyer not found.' });
    }
});

const updateBuyerProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'Buyer') {
        return res.status(404).json({ success: false, message: 'Buyer not found.' });
    }

    // Check duplicate mobile number
    if (req.body.mobileNumber && req.body.mobileNumber !== user.mobileNumber) {
        const existingUser = await User.findOne({ mobileNumber: req.body.mobileNumber });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Mobile number already in use.' });
        }
        user.mobileNumber = req.body.mobileNumber;
    }

    // Handle profile image upload
    if (req.file) {
        try {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'profile-images',
                resource_type: 'image'
            });
            user.profilePicture = result.secure_url;
        } catch (error) {
            console.error('Cloudinary upload error:', error);
            return res.status(500).json({ success: false, message: 'Profile image upload failed.' });
        }
    }

    user.name = req.body.name || user.name;

    // Update address if provided
    if (req.body.pinCode || req.body.city) {
        user.address = {
            pinCode: req.body.pinCode || (user.address ? user.address.pinCode : undefined),
            houseNumber: req.body.houseNumber || (user.address ? user.address.houseNumber : undefined),
            locality: req.body.locality || (user.address ? user.address.locality : undefined),
            city: req.body.city || (user.address ? user.address.city : undefined),
            district: req.body.district || (user.address ? user.address.district : undefined),
        };
    }

    const updatedUser = await user.save();
    res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
            id: updatedUser.id,
            name: updatedUser.name,
            mobileNumber: updatedUser.mobileNumber,
            profilePicture: updatedUser.profilePicture,
            address: updatedUser.address
        }
    });
});

const updateBuyerLocation = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'Buyer') {
        return res.status(404).json({ success: false, message: 'Buyer not found.' });
    }

    // Create or update the address object
    user.address = {
        pinCode: req.body.pinCode,
        houseNumber: req.body.houseNumber,
        locality: req.body.locality,
        city: req.body.city,
        district: req.body.district,
        state: req.body.state

    };

    // Handle live location data (optional)
    if (req.body.latitude && req.body.longitude) {
        user.location = {
            type: 'Point',
            coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)]
        };
    } else if (user.location) {
        // If not provided, ensure the GeoJSON type is removed if it was a Point
        user.location = undefined;
    }

    await user.save();
    res.status(200).json({ success: true, message: 'Location updated successfully.', address: user.address, location: user.location });
});


const updateBuyerLanguage = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'Buyer') {
        return res.status(404).json({ success: false, message: 'Buyer not found.' });
    }
    user.language = req.body.language || user.language;
    await user.save();
    res.status(200).json({ success: true, message: 'Language updated successfully.', language: user.language });
});

const logout = asyncHandler(async (_req, res) => {
    // implement token blacklist if needed
    res.json({ success: true, message: 'Logged out successfully' });
});

// -----------------------------
// Addresses
// -----------------------------

const addAddress = asyncHandler(async (req, res) => {
    const { name, mobileNumber, pinCode, houseNumber, locality, city, district, state, isDefault } = req.body;

    // Optional: Make existing default address non-default
    if (isDefault) {
        await Address.updateMany({ user: req.user._id, isDefault: true }, { isDefault: false });
    }

    const newAddress = await Address.create({
        user: req.user._id,
        name,
        mobileNumber,
        pinCode,
        houseNumber,
        locality,
        city,
        district,
        state,
        isDefault: isDefault || false
    });

    res.status(201).json({ success: true, message: 'Address added successfully.', address: newAddress });
});

const getAddresses = asyncHandler(async (req, res) => {
    const addresses = await Address.find({ user: req.user._id }).sort({ isDefault: -1 });
    res.status(200).json({ success: true, addresses });
});


const setDefaultAddress = asyncHandler(async (req, res) => {
    await Address.updateMany({ user: req.user._id }, { isDefault: false });
    const address = await Address.findByIdAndUpdate(req.params.id, { isDefault: true }, { new: true });
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Default address set', data: address });
});

module.exports = {
    getHomePageData,
    getProductDetails,
    getFilteredProducts,
    getVendorsNearYou,
    getCartItems,
    addItemToCart,
    removeItemFromCart,
    updateCartItemQuantity,
    placeOrder,
    getBuyerOrders,
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    reorder,
    getBuyerProfile,
    updateBuyerProfile,
    logout,
    getOrderDetails,
    setDefaultAddress,
    updateBuyerLocation,
    updateBuyerLanguage,
    writeReview,
    getBuyerOrders,getLocalBestProducts,getAllAroundIndiaProducts,getSmartPicks,
    getOrderDetails, searchProducts,generateUpiPaymentUrl,getFreshAndPopularProducts,
    getReviewsForProduct, updateReview, deleteReview, applyCouponToCart, startCheckout, verifyPayment, addAddress, getAddresses, getStaticPageContent
};
