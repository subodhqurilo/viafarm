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
const QRCode = require('qrcode');

// -----------------------------
// Home & Product Discovery
// -----------------------------

// @desc    Get buyer home screen data
// @route   GET /api/buyer/home
// @access  Private/Buyer

// Add this at the top or above your controller function


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

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    // 1️⃣ Fetch Product with Vendor
    const product = await Product.findById(id)
        .populate('vendor', 'name address mobileNumber rating location');

    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // 2️⃣ Fetch Nutritional Value
    let nutritionalInfo = product.nutritionalValue || await NutritionalValue.findOne({ product: id });

    // 3️⃣ Fetch Reviews (include comment & images)
    const reviewsRaw = await Review.find({ product: id })
        .populate('user', 'name profilePicture')
        .select('rating comment images createdAt updatedAt')
        .sort({ createdAt: -1 })
        .limit(5);

    const reviews = reviewsRaw.map(r => ({
        _id: r._id,
        user: r.user,
        rating: r.rating,
        comment: r.comment || '',  
        images: r.images,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
    }));

    // 4️⃣ Recommended Products
    const recommendedProducts = await Product.find({
        category: product.category,
        _id: { $ne: product._id },
        status: 'In Stock'
    })
    .sort({ rating: -1 })
    .limit(3);

    // 5️⃣ Response
    res.status(200).json({
        success: true,
        data: {
            product: {
                ...product.toObject(),
                nutritionalValue: nutritionalInfo
            },
            vendor: {
                id: product.vendor._id,
                name: product.vendor.name,
                mobileNumber: product.vendor.mobileNumber,
                rating: product.vendor.rating || 0,
                address: product.vendor.address || {}, // full address object
                location: product.vendor.location || {} // coordinates and type
            },
            reviews: {
                totalCount: await Review.countDocuments({ product: id }),
                list: reviews
            },
            recommendedProducts
        }
    });
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


// @desc    Get all products grouped by category for the logged-in vendor
// @route   GET /api/vendor/products/by-category
// @access  Private/Vendor
const getProductsByCategory = asyncHandler(async (req, res) => {
    const { category } = req.query;

    if (!category) {
        return res.status(400).json({ success: false, message: "Category is required" });
    }

    const products = await Product.find({ category }).populate("vendor", "name");

    res.status(200).json({
        success: true,
        count: products.length,
        data: products,
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
    const userId = req.user._id;

    // 1. Fetch Cart and Populate Products
    const cart = await Cart.findOne({ user: userId }).populate('items.product');

    // Default empty state for the summary
    const emptySummary = { totalMRP: 0, discount: 0, deliveryCharge: 0, totalAmount: 0 };

    // 2. Handle Empty Cart Scenario
    if (!cart || cart.items.length === 0) {
        return res.json({ 
            success: true, 
            data: { items: [], summary: emptySummary } 
        });
    }

    // 3. Calculate Summary (including coupon validation if code is present)
    const summary = await calculateOrderSummary(cart, cart.couponCode);

    // 4. Build Clean Response Data Structure
    const filteredItems = cart.items
        .filter(item => item.product) // Filter out items where the product might have been deleted
        .map(item => ({
            product: {
                id: item.product._id,
                name: item.product.name,
                price: item.price, // Use price snapshot from cart
                image: item.product.images ? item.product.images[0] : null,
                unit: item.product.unit,
                // Add any other core product fields needed for display (e.g., variety)
            },
            quantity: item.quantity,
            vendor: item.vendor // Vendor ID
        }));

    res.json({ 
        success: true, 
        data: { 
            items: filteredItems, 
            summary: summary 
        } 
    });
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

    if (!productId || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Product ID and valid quantity are required.' });
    }

    // Find or create cart
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

    // Fetch product and vendor info
    const product = await Product.findById(productId).select('name price vendor status images unit');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (product.status !== 'In Stock') return res.status(400).json({ success: false, message: 'Product is out of stock.' });

    // Check if product already exists in cart
    const itemIndex = cart.items.findIndex(i => i.product.toString() === productId);
    if (itemIndex > -1) {
        cart.items[itemIndex].quantity += Number(quantity);
        cart.items[itemIndex].price = product.price; // update snapshot price
    } else {
        cart.items.push({
            product: product._id,
            quantity: Number(quantity),
            vendor: product.vendor,
            price: product.price
        });
    }

    await cart.save();

    // Populate products for response
    await cart.populate('items.product');

    // Calculate order summary (supports coupon)
    const summary = await calculateOrderSummary(cart.items, cart.couponCode);

    // Format response for frontend
    const items = cart.items
        .filter(i => i.product)
        .map(i => ({
            product: {
                id: i.product._id,
                name: i.product.name,
                price: i.price,
                image: i.product.images?.[0] || null,
                unit: i.product.unit
            },
            quantity: i.quantity,
            vendorId: i.product.vendor?._id || null,
            vendorName: i.product.vendor?.name || null
        }));

    res.status(200).json({
        success: true,
        message: 'Item added to cart',
        data: { items, summary }
    });
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


// Haversine formula to calculate distance in km


// Helper function to calculate distance (kept outside for cleanliness)

// Assuming these models/utilities are available via imports
// const User = require('../models/User'); 
// const Product = require('../models/Product'); 
// const Review = require('../models/Review'); 

// Helper function to calculate distance between two GeoJSON points (Haversine formula in KM)



// @desc    Get detailed vendor profile, location, reviews, and listed products for buyer view
// @route   GET /api/buyer/vendors/:vendorId
// @access  Private/Buyer
const getVendorProfileForBuyer = asyncHandler(async (req, res) => {
    const { vendorId } = req.params;
    const { buyerLat, buyerLng, category } = req.query;

    // Fetch Vendor
    const vendor = await User.findById(vendorId)
        .where('role').equals('Vendor')
        .where('status').equals('Active')
        .select('name profilePicture address vendorDetails location rating mobileNumber');

    if (!vendor) {
        return res.status(404).json({ success: false, message: 'Vendor not found or inactive.' });
    }

    // Distance Calculation
    let distanceKm = null;
    if (buyerLat && buyerLng && vendor.location?.coordinates) {
        try {
            distanceKm = calculateDistance(
                parseFloat(buyerLat),
                parseFloat(buyerLng),
                vendor.location.coordinates[1],
                vendor.location.coordinates[0]
            ).toFixed(1);
        } catch (e) {
            console.error("Distance calculation failed:", e);
        }
    }

    // Fetch Reviews (from products listed by vendor)
    const vendorProducts = await Product.find({ vendor: vendorId }).select('_id');
    const productIds = vendorProducts.map(p => p._id);
    const reviewsRaw = await Review.find({ product: { $in: productIds } })
        .populate('user', 'name profilePicture')
        .sort({ createdAt: -1 })
        .limit(5);

    // Map comment field
    const reviews = reviewsRaw.map(r => ({
        _id: r._id,
        user: r.user,
        rating: r.rating,
        comment: r.comment, // ✅ ensures comment is in response
        images: r.images,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
    }));

    const reviewCount = await Review.countDocuments({ product: { $in: productIds } });

    // Fetch Listed Products
    const productFilter = { vendor: vendorId, status: 'In Stock' };
    if (category) productFilter.category = category;

    const listedProducts = await Product.find(productFilter)
        .select('name category variety price quantity unit images rating')
        .sort({ rating: -1 })
        .limit(20);

    res.status(200).json({
        success: true,
        data: {
            vendor: {
                id: vendor._id,
                name: vendor.name,
                mobileNumber: vendor.mobileNumber,
                profilePicture: vendor.profilePicture,
                locationText: vendor.address?.locality || vendor.address?.city || 'Unknown Location',
                distance: distanceKm ? `${distanceKm} kms away` : null,
                about: vendor.vendorDetails?.about || '', // ✅ sends saved about field
                rating: vendor.rating || 0
            },
            reviews: {
                count: reviewCount,
                list: reviews
            },
            listedProducts,
            availableCategories: await Product.distinct('category', { vendor: vendorId })
        }
    });
});





const getProductReviews = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    // 1. Fetch Product Name/Details for Context
    const product = await Product.findById(productId).select('name variety category');
    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // 2. Fetch all reviews for this product
    const reviews = await Review.find({ product: productId })
        .populate('user', 'name profilePicture') // Populate the buyer who wrote the review
        .sort({ createdAt: -1 });

    // 3. Calculate Average Rating (Optional but good for UI)
    const averageRating = reviews.length > 0 
        ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1) 
        : 0;

    res.status(200).json({
        success: true,
        data: {
            product: {
                id: product._id,
                name: product.name,
                variety: product.variety,
                category: product.category,
                totalReviews: reviews.length,
                averageRating: parseFloat(averageRating)
            },
            reviews: reviews, // The full list of reviews
        }
    });
});

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

const generateUpiPaymentUrl = (upiId, name, amount, transactionId) => {
  const payeeVpa = encodeURIComponent(upiId);
  const payeeName = encodeURIComponent(name);
  const transactionNote = encodeURIComponent(`Payment for Orders: ${transactionId}`);
  const encodedAmount = encodeURIComponent(amount.toFixed(2));

  return `upi://pay?pa=${payeeVpa}&pn=${payeeName}&am=${encodedAmount}&tn=${transactionNote}&tr=${transactionId}&cu=INR`;
};

/**
 * @desc    Place multi-vendor order and generate UPI + QR Code dynamically
 * @route   POST /api/buyer/orders/place
 * @access  Private/Buyer
 */
const placeOrder = asyncHandler(async (req, res) => {
  const { shippingAddressId, pickupSlot, orderType, couponCode, comments, donation } = req.body;
  const userId = req.user._id;

  // 1️⃣ Validation
  if (!orderType || !['Delivery', 'Pickup'].includes(orderType)) {
    return res.status(400).json({ success: false, message: 'Valid orderType is required (Delivery or Pickup).' });
  }

  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Cart is empty.' });
  }

  const validItems = cart.items.filter(i => i.product);

  // 2️⃣ Stock Check
  for (const item of validItems) {
    if (item.product.status !== 'In Stock' || item.quantity > item.product.quantity) {
      return res.status(400).json({
        success: false,
        message: `Product "${item.product.name}" is out of stock or insufficient quantity.`,
      });
    }
  }

  // 3️⃣ Shipping/Pickup
  let shippingAddress = null;
  if (orderType === 'Delivery') {
    shippingAddress = await Address.findById(shippingAddressId);
    if (!shippingAddress)
      return res.status(404).json({ success: false, message: 'Shipping address not found.' });
  } else if (orderType === 'Pickup' && !pickupSlot) {
    return res.status(400).json({ success: false, message: 'Pickup slot is required for Pickup orders.' });
  }

  // 4️⃣ Group by Vendor
  const ordersByVendor = {};
  validItems.forEach(item => {
    const vendorId = item.product.vendor?.toString();
    if (vendorId) {
      if (!ordersByVendor[vendorId]) ordersByVendor[vendorId] = [];
      ordersByVendor[vendorId].push(item);
    }
  });

  const newOrders = [];
  const createdOrderIds = [];
  const payments = [];

  // 5️⃣ Process each vendor
  for (const vendorId in ordersByVendor) {
    const vendorItems = ordersByVendor[vendorId];
    const summary = await calculateOrderSummary(vendorItems, couponCode);

    const orderProducts = vendorItems.map(item => ({
      product: item.product._id,
      quantity: item.quantity,
      price: item.product.price,
      vendor: item.product.vendor,
    }));

    const newOrder = await Order.create({
      orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`,
      buyer: userId,
      vendor: vendorId,
      products: orderProducts,
      totalPrice: summary.totalAmount,
      orderStatus: 'In-process',
      orderType,
      shippingAddress: shippingAddress || null,
      pickupSlot,
      comments,
      donation,
    });

    newOrders.push(newOrder);
    createdOrderIds.push(newOrder.orderId);

    // 🧾 Deduct stock
    for (const item of vendorItems) {
      await Product.findByIdAndUpdate(item.product._id, { $inc: { quantity: -item.quantity } });
    }

    // 💳 Get vendor UPI info
    const vendor = await User.findById(vendorId).select('name upiId');
    const transactionRef = `TXN-${newOrder.orderId}-${Date.now()}`;

    // 💰 Generate UPI Link + QR
    const upiUrl = generateUpiPaymentUrl(vendor.upiId, vendor.name, summary.totalAmount, transactionRef);
    const qrCodeDataUrl = await QRCode.toDataURL(upiUrl);

    payments.push({
      vendorId,
      vendorName: vendor.name,
      upiId: vendor.upiId,
      amount: summary.totalAmount.toFixed(2),
      upiUrl,
      qrCode: qrCodeDataUrl,
      transactionRef,
    });
  }

  // 6️⃣ Clear cart
  cart.items = [];
  cart.couponCode = undefined;
  await cart.save();

  // 7️⃣ Respond
  res.status(201).json({
    success: true,
    message: 'Orders placed successfully. Awaiting payment verification.',
    orders: createdOrderIds,
    payments,
  });
});







const getBuyerOrders = asyncHandler(async (req, res) => {
    const buyerId = req.user._id;

    // 1. Fetch orders
    const orders = await Order.find({ buyer: buyerId }).sort({ createdAt: -1 }).lean();

    // 2. Deeply populate product and vendor details for each item
    const populatedOrders = await Promise.all(
        orders.map(async (order) => {
            const items = Array.isArray(order.products) ? await Promise.all( // Assuming 'products' field holds item array
                order.products.map(async (item) => {
                    if (!item || !item.product) return null;

                    const product = await Product.findById(item.product)
                        .select('name images price vendor')
                        .lean();
                    if (!product) return null;

                    const vendor = await User.findById(product.vendor)
                        .select('name') // Only need vendor name for list view
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

const formatDeliveryDate = (date) => {
    if (!date) return 'N/A';
    const deliveryDate = new Date(date);
    
    // Add a consistent delivery buffer (e.g., 3 days)
    deliveryDate.setDate(deliveryDate.getDate() + 3); 

    const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    
    // Get the formatted date string (e.g., "Fri, Sep 20, 2025")
    const formattedDate = deliveryDate.toLocaleDateString('en-US', options);

    // Reformat to match your exact "Fri, 20 Sep 2025" style
    const [weekday, month, day, year] = formattedDate.split(/[\s,]+/);

    // Reorder: Fri, 20 Sep 2025
    return `${weekday}, ${day} ${month} ${year}`;
};


/**
 * @desc    Get detailed information for a single order, including vendor and shipping details.
 * @route   GET /api/buyer/orders/:orderId
 * @access  Private/Buyer
 */
const getOrderDetails = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    
    // 1. Find the order for the authenticated buyer
    const order = await Order.findOne({ _id: orderId, buyer: req.user._id }).lean(); 

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 2. Populate product and vendor details for each item
    const populatedItems = await Promise.all(
        (order.products || []).map(async (item) => { 
            if (!item.product) return null;

            const product = await Product.findById(item.product).select('name images variety price unit vendor').lean();
            if (!product) return null;

            const vendor = await User.findById(product.vendor).select('name mobileNumber address profilePicture').lean();

            return {
                ...item,
                product: product,
                vendor: vendor
            };
        })
    );

    // 3. Format Item Data and Consolidate Primary Vendor Details
    const finalItems = [];
    let primaryVendorDetails = {};
    let buyerShippingAddress = {};

    for (const item of populatedItems.filter(Boolean)) {
        finalItems.push({
            name: item.product.name,
            subtext: item.product.variety || item.product.category,
            quantity: item.quantity,
            image: item.product.images ? item.product.images[0] : null,
            id: item.product._id,
        });

        if (item.vendor) {
            primaryVendorDetails = {
                name: item.vendor.name,
                mobileNumber: item.vendor.mobileNumber,
                location: item.vendor.address.locality || item.vendor.address.city || 'N/A',
                profilePicture: item.vendor.profilePicture
            };
        }
    }
    
    if (order.shippingAddress) {
        buyerShippingAddress = order.shippingAddress;
    }
    
    // 4. Final Response Structure - DYNAMICALLY CALCULATE DELIVERY DATE
    const finalOrder = {
        ...order,
        vendorDetails: primaryVendorDetails,
        items: finalItems,
        shippingAddress: buyerShippingAddress,
        deliveryDate: formatDeliveryDate(order.createdAt) // Using order creation date + buffer
    };


    res.status(200).json({ success: true, order: finalOrder });
});

const applyCouponToCart = asyncHandler(async (req, res) => {
    const { code } = req.body;
    const userId = req.user._id;

    // 1. Fetch Cart and Coupon
    // Populate cart items to check coupon applicability later
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    
    // Check status and validity dates in the query
const coupon = await Coupon.findOne({
    code,
    status: 'Active',
    validFrom: { $lte: new Date() }, // matches your field
    validTill: { $gte: new Date() } // matches your field
});

    if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found.' });
    }
    if (!coupon) {
        return res.status(400).json({ success: false, message: 'Invalid, expired, or inactive coupon code.' });
    }

    // 2. Usage Limit Check (Per User)
    // Assuming you have a tracking mechanism (e.g., in a separate model or on the User model)
    // For this implementation, we will assume a hypothetical Order.countDocuments check for simplicity.
    const userUsageCount = await Order.countDocuments({ 
        buyer: userId, 
        couponCode: code, 
        orderStatus: { $in: ['Confirmed', 'Completed'] } 
    });

    if (userUsageCount >= coupon.usageLimitPerUser) {
        return res.status(400).json({ success: false, message: 'This coupon has reached its usage limit for your account.' });
    }
    
    // 3. Minimum Order Value Check (Must be done before final summary calculation)
    const preliminarySummary = await calculateOrderSummary(cart, null); // Calculate total without the coupon first
    
    if (preliminarySummary.totalMRP < coupon.minimumOrder) {
        return res.status(400).json({ success: false, message: `Minimum order value of ${coupon.minimumOrder} required to use this coupon.` });
    }

    // 4. Applicability Check (e.g., Specific Product/Category/Vendor)
    const isCouponApplicable = cart.items.some(item => {
        // If the coupon applies to everything, it's immediately valid
        if (coupon.appliesTo === 'All Products') {
            return true;
        }

        // --- Custom Logic for specific targets ---
        if (!coupon.applicableId) return false;

        const targetId = coupon.applicableId.toString();

        if (coupon.appliesTo === 'Specific Vendor' && item.vendor.toString() === targetId) {
            return true;
        }
        // Add more logic here for Specific Product or Specific Category
        // else if (coupon.appliesTo === 'Specific Category' && item.product.category === targetCategory) {}
        
        return false;
    });

    if (!isCouponApplicable) {
        return res.status(400).json({ success: false, message: 'This coupon is not valid for any items in your cart.' });
    }

    // 5. Final Summary Calculation (with coupon code)
    const finalSummary = await calculateOrderSummary(cart, code);

    // 6. Apply Coupon to Cart (Persist code)
    cart.couponCode = code;
    await cart.save();

    res.status(200).json({ success: true, message: 'Coupon applied successfully.', summary: finalSummary });
});

const getAvailableCouponsForBuyer = asyncHandler(async (req, res) => {
    const now = new Date();

    // The query filters for coupons that are:
    // 1. Currently marked as 'Active'
    // 2. Not yet expired (validTill > now)
    // 3. Already valid (validFrom <= now)
    const availableCoupons = await Coupon.find({
        status: 'Active',
        validTill: { $gte: now },
        validFrom: { $lte: now }
    })
    .select('code discount appliesTo minimumOrder usageLimitPerUser startDate expiryDate applicableId')
    .sort({ discount: -1, minimumOrder: 1 }); // Sort by highest discount, lowest minimum order

    if (!availableCoupons || availableCoupons.length === 0) {
        return res.status(200).json({
            success: true,
            message: 'No available coupons at this time.',
            data: []
        });
    }

    res.status(200).json({
        success: true,
        count: availableCoupons.length,
        data: availableCoupons
    });
});


const getCouponsByProductId = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    // Fetch product
    const product = await Product.findById(productId)
        .populate('vendor', '_id')
        .select('_id category vendor');

    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    const now = new Date();

    // Build coupon conditions
    const orConditions = [
        { appliesTo: 'All Products' },
        { appliesTo: 'Specific Product', applicableId: product._id },
        { appliesTo: 'Specific Vendor', applicableId: product.vendor._id },
    ];

    // Only add category filter if it's an ObjectId
    if (mongoose.Types.ObjectId.isValid(product.category)) {
        orConditions.push({ appliesTo: 'Specific Category', applicableId: product.category });
    } else {
        // If category is string, match coupons with string applicableId
        orConditions.push({ appliesTo: 'Specific Category', applicableId: product.category });
    }

    const coupons = await Coupon.find({
        status: 'Active',
        startDate: { $lte: now },
        expiryDate: { $gte: now },
        $or: orConditions
    })
    .sort({ 'discount.value': -1, minimumOrder: 1 })
    .select('-__v')
    .lean();

    res.status(200).json({
        success: true,
        count: coupons.length,
        data: coupons
    });
});



const getHighlightedCoupon = asyncHandler(async (req, res) => {
    const now = new Date();

    // 1️⃣ Find the best active coupon
    // Sort by highest discount first, then lowest minimum order
    const bestCoupon = await Coupon.findOne({
        status: 'Active',
        startDate: { $lte: now },
        expiryDate: { $gte: now }
    })
    .sort({ 'discount.value': -1, minimumOrder: 1 })
    .select('code discount minimumOrder appliesTo applicableId')
    .lean();

    // 2️⃣ Handle no coupon case
    if (!bestCoupon) {
        return res.status(200).json({
            success: true,
            message: 'No active coupons available at this time.',
            data: null
        });
    }

    // 3️⃣ Log the type of coupon for debugging
    console.log(`Selected coupon: ${bestCoupon.code}`);
    console.log(`Applies to: ${bestCoupon.appliesTo}`);
    if (bestCoupon.applicableId) console.log(`Applicable ID: ${bestCoupon.applicableId}`);

    // 4️⃣ Return response
    res.status(200).json({
        success: true,
        message: 'Best active coupon retrieved successfully.',
        data: bestCoupon
    });
});




// -----------------------------
// Wishlist
// -----------------------------

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = angle => (angle * Math.PI) / 180;
    const R = 6371; // Radius of Earth in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const getWishlist = asyncHandler(async (req, res) => {
    const buyer = await User.findById(req.user._id);

    if (!buyer) {
        return res.status(404).json({ success: false, message: 'Buyer not found.' });
    }

    const wishlist = await Wishlist.findOne({ user: req.user._id }).populate('items.product');

    if (!wishlist || !wishlist.items.length) {
        return res.status(200).json({ success: true, data: { items: [] } });
    }

    const items = await Promise.all(
        wishlist.items.map(async (item) => {
            const product = item.product;
            if (!product) return null;

            const vendor = await User.findById(product.vendor)
                .where('role').equals('Vendor')
                .where('status').equals('Active')
                .select('name profilePicture mobileNumber vendorDetails location address rating');

            // Calculate distance if buyer and vendor coordinates exist
            let distance = 'Unknown distance';
            if (buyer.location?.coordinates && vendor?.location?.coordinates) {
                distance = `${calculateDistance(
                    buyer.location.coordinates[1],
                    buyer.location.coordinates[0],
                    vendor.location.coordinates[1],
                    vendor.location.coordinates[0]
                ).toFixed(1)} kms away`;
            }

            return {
                id: product._id,
                name: product.name,
                category: product.category,
                variety: product.variety,
                rating: product.rating || 0,
                image: product.images?.[0] || null,
                price: product.price,
                unit: product.unit,
                vendor: vendor
                    ? {
                          id: vendor._id,
                          name: vendor.name,
                          mobileNumber: vendor.mobileNumber || null,
                          profilePicture: vendor.profilePicture || null,
                          locationText: vendor.address?.locality || vendor.address?.city || 'Unknown Location',
                          distance,
                          about: vendor.vendorDetails?.about || '',
                          rating: vendor.rating || 0,
                      }
                    : null,
            };
        })
    );

    res.status(200).json({
        success: true,
        data: {
            items: items.filter(i => i !== null), // remove null items if any
        },
    });
});






/**
 * @desc    Add an item to the buyer's wishlist.
 * @route   POST /api/buyer/wishlist/add
 * @access  Private/Buyer
 */

const addToWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.body;
    const userId = req.user._id;

    if (!productId) {
        return res.status(400).json({ success: false, message: 'Product ID is required.' });
    }

    // 1. Check if product exists
    const product = await Product.findById(productId).populate('vendor', 'name profilePicture mobileNumber vendorDetails location address rating');
    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // 2. Find or create the wishlist
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
        wishlist = await Wishlist.create({ user: userId, items: [] });
    }

    // 3. Check if product already exists
    const alreadyExists = wishlist.items.some(item => item.product.toString() === productId);
    if (alreadyExists) {
        return res.status(200).json({
            success: true,
            message: 'Product is already in your wishlist.',
            data: {
                product: {
                    id: product._id,
                    name: product.name,
                    category: product.category,
                    variety: product.variety,
                    rating: product.rating || 0,
                    image: product.images?.[0] || null,
                    price: product.price,
                    unit: product.unit,
                    vendor: product.vendor ? {
                        id: product.vendor._id,
                        name: product.vendor.name,
                        mobileNumber: product.vendor.mobileNumber || null,
                        profilePicture: product.vendor.profilePicture || null,
                        locationText: product.vendor.address?.locality || product.vendor.address?.city || 'Unknown Location',
                        about: product.vendor.vendorDetails?.about || '',
                        rating: product.vendor.rating || 0
                    } : null,
                    status: 'existing'
                }
            }
        });
    }

    // 4. Add the product to wishlist
    wishlist.items.push({ product: productId });
    await wishlist.save();

    res.status(201).json({
        success: true,
        message: 'Product successfully added to wishlist.',
        data: {
            product: {
                id: product._id,
                name: product.name,
                category: product.category,
                variety: product.variety,
                rating: product.rating || 0,
                image: product.images?.[0] || null,
                price: product.price,
                unit: product.unit,
                vendor: product.vendor ? {
                    id: product.vendor._id,
                    name: product.vendor.name,
                    mobileNumber: product.vendor.mobileNumber || null,
                    profilePicture: product.vendor.profilePicture || null,
                    locationText: product.vendor.address?.locality || product.vendor.address?.city || 'Unknown Location',
                    about: product.vendor.vendorDetails?.about || '',
                    rating: product.vendor.rating || 0
                } : null,
                status: 'added'
            }
        }
    });
});

module.exports = { addToWishlist };



/**
 * @desc    Remove an item from the buyer's wishlist.
 * @route   DELETE /api/buyer/wishlist/:id
 * @access  Private/Buyer
 */

const removeFromWishlist = asyncHandler(async (req, res) => {
    const { id } = req.params; // Product ID to remove
    const userId = req.user._id;

    // 1. Find the user's wishlist
    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
        return res.status(404).json({ success: false, message: 'Wishlist not found.' });
    }

    // 2. Find product details (optional, for response)
    const product = await Product.findById(id).populate('vendor', 'name profilePicture mobileNumber vendorDetails address rating');
    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const initialLength = wishlist.items.length;

    // 3. Remove product from wishlist
    wishlist.items = wishlist.items.filter(item => item.product.toString() !== id);

    if (wishlist.items.length === initialLength) {
        return res.status(404).json({ success: false, message: 'Item not found in wishlist.' });
    }

    await wishlist.save();

    // 4. Return detailed response
    res.json({
        success: true,
        message: 'Removed from wishlist successfully.',
        data: {
            product: {
                id: product._id,
                name: product.name,
                category: product.category,
                variety: product.variety,
                rating: product.rating || 0,
                image: product.images?.[0] || null,
                price: product.price,
                unit: product.unit,
                vendor: product.vendor ? {
                    id: product.vendor._id,
                    name: product.vendor.name,
                    mobileNumber: product.vendor.mobileNumber || null,
                    profilePicture: product.vendor.profilePicture || null,
                    locationText: product.vendor.address?.locality || product.vendor.address?.city || 'Unknown Location',
                    about: product.vendor.vendorDetails?.about || '',
                    rating: product.vendor.rating || 0
                } : null
            }
        }
    });
});



// -----------------------------
// Reviews
// -----------------------------




const writeReview = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { rating, comment, orderId } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating is required (1-5).' });
    }

    const order = await Order.findById(orderId).populate('products.product');
    if (!order || order.buyer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to review this order.' });
    }

    const productInOrder = order.products.find(
        (item) => item.product._id.toString() === productId.toString()
    );
    if (!productInOrder) {
        return res.status(400).json({ success: false, message: 'Product not found in this order.' });
    }

    const images = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'product-reviews' });
            images.push(result.secure_url);
        }
    }

    // Save review
    const review = await Review.create({
        product: productId,
        user: req.user._id,
        rating,
        comment,  // ✅ make sure it's saved
        images,
        order: orderId,
        orderItem: `${orderId}-${productId}`,
    });

    // Repopulate with product + user + comment
    const populatedReview = await Review.findById(review._id)
        .populate('user', 'name')
        .populate('product', 'name variety');

    res.status(201).json({
        success: true,
        message: 'Review submitted successfully.',
        review: populatedReview
    });
});







// @desc    Get checkout data for the buyer
// @route   GET /api/buyer/checkout
// @access  Private/Buyer
// controllers/buyerController.js (replace startCheckout)

const startCheckout = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // 1. Fetch Cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }
    const validItems = cart.items.filter(i => i.product);

    // 2. Group items by vendor
    const itemsByVendor = {};
    validItems.forEach(item => {
        const vendorId = item.vendor.toString();
        if (!itemsByVendor[vendorId]) itemsByVendor[vendorId] = [];
        itemsByVendor[vendorId].push(item);
    });

    // 3. Prepare vendor-wise summary with UPI QR
    const vendorSummaries = [];
    for (const vendorId in itemsByVendor) {
        const vendorItems = itemsByVendor[vendorId];
        const summary = await calculateOrderSummary(vendorItems, cart.couponCode);

        const vendor = await User.findById(vendorId).select('name address mobileNumber upiId');

        // Generate UPI transaction reference
        const transactionRef = `TXN-${vendorItems[0]._id}-${Date.now()}`;
        let upiUrl = null;
        let qrCodeDataUrl = null;

        if (vendor.upiId) {
            // Generate UPI URL
            const payeeVpa = encodeURIComponent(vendor.upiId);
            const payeeName = encodeURIComponent(vendor.name);
            const transactionNote = encodeURIComponent(`Payment for vendor order: ${transactionRef}`);
            const amount = encodeURIComponent(summary.totalAmount.toFixed(2));

            upiUrl = `upi://pay?pa=${payeeVpa}&pn=${payeeName}&am=${amount}&tn=${transactionNote}&tr=${transactionRef}&cu=INR`;

            // Generate QR code (Base64)
            qrCodeDataUrl = await QRCode.toDataURL(upiUrl);
        }

        vendorSummaries.push({
            vendorId,
            vendorName: vendor.name,
            vendorAddress: vendor.address,
            vendorPhone: vendor.mobileNumber,
            items: vendorItems.map(item => ({
                productId: item.product._id,
                name: item.product.name,
                price: item.price,
                unit: item.product.unit,
                quantity: item.quantity,
                image: item.product.images ? item.product.images[0] : null
            })),
            summary,
            upiId: vendor.upiId || null,
            upiUrl,
            qrCode: qrCodeDataUrl,
            transactionRef
        });
    }

    // 4. Fetch addresses & coupons
    const addresses = await Address.find({ user: userId }).sort({ isDefault: -1 });
    const defaultAddress = addresses.find(a => a.isDefault) || addresses[0] || null;
    const coupons = await Coupon.find({ status: 'Active' });

    // 5. Final response
    res.status(200).json({
        success: true,
        data: {
            cart: {
                couponCode: cart.couponCode,
                vendors: vendorSummaries
            },
            addresses,
            defaultAddress,
            availableCoupons: coupons
        }
    });
});



// @desc    Generate UPI payment URL
// @route   POST /api/buyer/upi-url
// @access  Private/Buyer









// @desc    Place an order
// @route   POST /api/buyer/orders/place
// @access  Private/Buyer









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

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const reviews = await Review.find({ product: productId })
        .populate('user', 'name profilePicture') // Ensure correct field name for profile image
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        count: reviews.length,
        data: reviews
    });
});



// @desc    Update a review
// @route   PUT /api/buyer/reviews/:reviewId
// @access  Private/Buyer
const updateReview = asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { rating, comment } = req.body;

    // 1️⃣ Find review
    let review = await Review.findById(reviewId);
    if (!review) {
        return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // 2️⃣ Authorization
    if (review.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // 3️⃣ Update fields
    if (rating) {
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
        }
        review.rating = rating;
    }
    if (comment !== undefined) review.comment = comment;

    // 4️⃣ Handle new images (replace only if provided)
    if (req.files && req.files.length > 0) {
        const images = [];
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, {
                folder: 'product-reviews'
            });
            images.push(result.secure_url);
        }
        review.images = images; // replace old images with new ones
    }

    // 5️⃣ Save
    await review.save();

    // 6️⃣ Re-fetch with populated fields for better response
    review = await Review.findById(review._id)
        .populate("user", "name profilePicture")
        .populate("product", "name variety");

    res.status(200).json({
        success: true,
        message: "Review updated successfully",
        review
    });
});



// @desc    Delete a review
// @route   DELETE /api/buyer/reviews/:reviewId
// @access  Private/Buyer
const deleteReview = asyncHandler(async (req, res) => {
    const { reviewId } = req.params;

    // 1️⃣ Find the review
    const review = await Review.findById(reviewId);
    if (!review) {
        return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // 2️⃣ Authorization
    if (review.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // 3️⃣ (Optional) Delete images from Cloudinary
    if (review.images && review.images.length > 0) {
        for (const imgUrl of review.images) {
            try {
                // Extract public_id from Cloudinary URL
                const publicId = imgUrl.split('/').slice(-1)[0].split('.')[0];
                await cloudinary.uploader.destroy(`product-reviews/${publicId}`);
            } catch (err) {
                console.error("Failed to delete image from Cloudinary:", err.message);
            }
        }
    }

    // 4️⃣ Delete review
    await review.deleteOne();

    // 5️⃣ Send response
    res.status(200).json({
        success: true,
        message: 'Review deleted successfully',
        reviewId: reviewId
    });
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
    const { 
        pinCode, 
        houseNumber, 
        locality, 
        city, 
        district, 
        latitude, 
        longitude 
    } = req.body;

    // --- 1. Address Validation (Mandatory fields from UI) ---
    if (!pinCode || !houseNumber || !locality || !city || !district) {
        return res.status(400).json({ 
            success: false, 
            message: 'All address fields (Pin Code, House Number, Locality, City, District) are required for an update.' 
        });
    }

    // --- 2. Build Update Object for Address Text ---
    const updateFields = {
        'address.pinCode': pinCode,
        'address.houseNumber': houseNumber,
        'address.locality': locality,
        'address.city': city,
        'address.district': district,
    };
    
    // --- 3. Handle GeoJSON Location (Optional) ---
    if (latitude && longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng)) {
             return res.status(400).json({ success: false, message: 'Invalid latitude or longitude provided.' });
        }
        
        // GeoJSON Point is always stored as [longitude, latitude]
        updateFields['location'] = {
            type: 'Point',
            coordinates: [lng, lat] 
        };
    } else {
        // Explicitly clear location if no new coordinates are provided
        updateFields['location'] = undefined;
    }
    
    // --- 4. Update and Respond ---
    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updateFields },
        { new: true, runValidators: true }
    );

    if (!updatedUser) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({
        success: true,
        message: 'Location updated successfully.',
        data: {
            address: updatedUser.address,
            location: updatedUser.location
        }
    });
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


const getPickupLocationDetails = asyncHandler(async (req, res) => {
  const { vendorId } = req.params;
  const { buyerLat, buyerLng } = req.query;

  // 🔍 Fetch vendor details
  const vendor = await User.findById(vendorId).select(
    "name mobileNumber address location profilePicture role"
  );

  if (!vendor || vendor.role !== "Vendor") {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found." });
  }

  // 📏 Calculate distance (if buyer location provided)
  let distanceKm = null;
  if (buyerLat && buyerLng && vendor.location?.coordinates) {
    try {
      distanceKm = calculateDistance(
        parseFloat(buyerLat),
        parseFloat(buyerLng),
        vendor.location.coordinates[1],
        vendor.location.coordinates[0]
      ).toFixed(1);
    } catch (err) {
      console.error("Distance calculation failed:", err);
      distanceKm = null;
    }
  }

  // 🏠 Construct pickup address dynamically
  const pickupAddress = vendor.address
    ? [
        vendor.address.houseNumber,
        vendor.address.locality || vendor.address.city,
        vendor.address.district,
      ]
        .filter(Boolean)
        .join(", ")
    : "Address not available";

  // 🕒 Generate next 3 dynamic pickup slots (2-hour intervals)
  const now = new Date();
  const pickupSlots = [];

  for (let i = 0; i < 3; i++) {
    const start = new Date(now.getTime() + i * 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    pickupSlots.push({
      startTime: start.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      endTime: end.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      available: true,
    });
  }

  // 📅 Format current pickup date
  const pickupDate = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // 🧾 Final Response
  res.status(200).json({
    success: true,
    data: {
      vendor: {
        name: vendor.name,
        profilePicture: vendor.profilePicture,
        phoneNo: vendor.mobileNumber,
        pickupLocationText: pickupAddress,
        distance: distanceKm ? `${distanceKm} kms away` : null,
      },
      defaultPickupDate: pickupDate,
      upcomingPickupSlots: pickupSlots, // now returns multiple dynamic slots
    },
  });
});



const getPickupLocationDetailsPost = asyncHandler(async (req, res) => {
    const { vendorId, buyerLat, buyerLng } = req.body;

    if (!vendorId) {
        return res.status(400).json({ success: false, message: "Vendor ID is required." });
    }

    // 1️⃣ Fetch vendor details
    const vendor = await User.findById(vendorId).select("name mobileNumber address location profilePicture role");

    if (!vendor || vendor.role !== "Vendor") {
        return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    // 2️⃣ Calculate distance
    let distanceKm = null;
    if (buyerLat && buyerLng && vendor.location?.coordinates?.length === 2) {
        try {
            // Note: coordinates are stored [lng, lat]
            distanceKm = calculateDistance(
                parseFloat(buyerLat),
                parseFloat(buyerLng),
                vendor.location.coordinates[1], // vendorLat
                vendor.location.coordinates[0]  // vendorLng
            ).toFixed(1);
        } catch (e) {
             distanceKm = null;
        }
    }

    // 3️⃣ Build pickup address display text
    const pickupAddress = vendor.address?.houseNumber
        ? `${vendor.address.houseNumber}, ${vendor.address.locality || vendor.address.city}, ${vendor.address.district}`
        : `${vendor.address?.locality || vendor.address?.city || "N/A"}`;

    // 4️⃣ Dynamic pickup hours & date (Current logic provides a slot 30 min from now + 2 hours)
    const now = new Date();
    const startTime = new Date(now.getTime() + 30 * 60000); 
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60000); 

    // Helper to format time as 10:30 AM
    const formatTime = (d) =>
        d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toLowerCase();

    const pickupHours = `${formatTime(startTime)} to ${formatTime(endTime)}`;
    const pickupDate = now.toLocaleDateString("en-GB"); // Formatted as dd/mm/yyyy

    // ✅ 5️⃣ Send response
    res.status(200).json({
        success: true,
        data: {
            vendor: {
                name: vendor.name,
                profilePicture: vendor.profilePicture,
                phoneNo: vendor.mobileNumber,
                pickupLocationText: pickupAddress,
                distance: distanceKm ? `${distanceKm} kms away` : null,
            },
            defaultPickupHours: pickupHours,
            defaultPickupDate: pickupDate,
        },
    });
});



const selectPickupSlot = asyncHandler(async (req, res) => {
  const { vendorId, date, startTime, endTime } = req.body;

  if (!vendorId || !date || !startTime || !endTime) {
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    return res.status(404).json({ success: false, message: "Cart not found." });
  }

  cart.pickupDetails = {
    vendor: vendorId,
    date,
    startTime,
    endTime,
  };

  await cart.save();

  res.status(200).json({
    success: true,
    message: "Pickup slot selected successfully.",
    data: cart.pickupDetails,
  });
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
    updateBuyerLanguage,getHighlightedCoupon,getPickupLocationDetails,getPickupLocationDetailsPost,selectPickupSlot,
    writeReview,getProductsByCategory,getVendorProfileForBuyer,getProductReviews,getAvailableCouponsForBuyer,
    getBuyerOrders,getLocalBestProducts,getAllAroundIndiaProducts,getSmartPicks,getCouponsByProductId,
    getOrderDetails, searchProducts,getFreshAndPopularProducts,generateUpiPaymentUrl,
    getReviewsForProduct, updateReview, deleteReview, applyCouponToCart, startCheckout, verifyPayment, addAddress, getAddresses, getStaticPageContent
};
