const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Category = require('../models/Category');
const { upload, cloudinary } = require('../services/cloudinaryService');
const Coupon = require('../models/Coupon');
const Address = require('../models/Address');
// -------------------------------
// Vendor Dashboard
// -------------------------------

// @desc    Get vendor dashboard data
// @route   GET /api/vendor/dashboard
// @access  Private/Vendor
const getDashboardData = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;

    // Calculate the start and end of today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    try {
        // Total orders for this vendor
        const totalOrders = await Order.countDocuments({ vendor: vendorId });

        // Total revenue from all orders for this vendor
        const totalRevenueAllResult = await Order.aggregate([
            { $match: { vendor: vendorId } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);
        const totalRevenueAll = totalRevenueAllResult[0]?.total || 0;

        // Total revenue from completed orders for this vendor
        const totalRevenueCompletedResult = await Order.aggregate([
            { $match: { vendor: vendorId, orderStatus: 'Completed' } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);
        const totalRevenueCompleted = totalRevenueCompletedResult[0]?.total || 0;

        // Total orders for today for this vendor
        const todayOrders = await Order.countDocuments({
            vendor: vendorId,
            createdAt: {
                $gte: startOfToday,
                $lte: endOfToday
            }
        });

        res.json({
            success: true,
            data: {
                totalOrders,
                totalRevenueAll,        // all orders revenue
                totalRevenueCompleted,  // only completed orders
                todayOrders,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard data.',
            error: error.message
        });
    }
});

const getVendorDashboardAnalytics = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const today = new Date();

    // --- 1. Customer Stats for Current Month vs. Last Year ---
    const currentMonth = today.getMonth(); // 0-indexed
    const currentYear = today.getFullYear();

    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    const endOfCurrentMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    const startOfLastYearMonth = new Date(currentYear - 1, currentMonth, 1);
    const endOfLastYearMonth = new Date(currentYear - 1, currentMonth + 1, 0, 23, 59, 59);

    const getUniqueCustomerCount = async (startDate, endDate) => {
        const result = await Order.aggregate([
            {
                $match: {
                    vendor: vendorId,
                    createdAt: { $gte: startDate, $lte: endDate },
                    orderStatus: { $in: ['In-process', 'Completed'] } // Only in-process and completed orders
                }
            },
            { $group: { _id: '$buyer' } }, // Unique buyers
            { $count: 'customerCount' }
        ]);
        return result.length > 0 ? result[0].customerCount : 0;
    };

    const currentMonthCustomers = await getUniqueCustomerCount(startOfCurrentMonth, endOfCurrentMonth);
    const lastYearMonthCustomers = await getUniqueCustomerCount(startOfLastYearMonth, endOfLastYearMonth);

    let percentageChange = 0;
    if (lastYearMonthCustomers > 0) {
        percentageChange = ((currentMonthCustomers - lastYearMonthCustomers) / lastYearMonthCustomers) * 100;
    } else if (currentMonthCustomers > 0) {
        percentageChange = 100;
    }

    // --- 2. Monthly Customer Data for Bar Chart ---
    const monthlyCustomerData = await Order.aggregate([
        {
            $match: {
                vendor: vendorId,
                createdAt: {
                    $gte: new Date(`${year}-01-01T00:00:00.000Z`),
                    $lte: new Date(`${year}-12-31T23:59:59.999Z`)
                },
                orderStatus: { $in: ['In-process', 'Completed'] } // Only consider these orders
            }
        },
        {
            $group: {
                _id: {
                    month: { $month: '$createdAt' },
                    buyer: '$buyer'
                }
            }
        },
        {
            $group: {
                _id: '$_id.month',
                customerCount: { $sum: 1 }
            }
        },
        { $sort: { '_id': 1 } }
    ]);

    const formattedChartData = Array.from({ length: 12 }, (_, i) => {
        const monthData = monthlyCustomerData.find(item => item._id === i + 1);
        return monthData ? monthData.customerCount : 0;
    });

    res.status(200).json({
        success: true,
        data: {
            currentMonthCustomers,
            percentageChangeVsLastYear: parseFloat(percentageChange.toFixed(1)),
            monthlyCustomerDataForYear: formattedChartData,
        }
    });
});

const getVendorOrderStats = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // --- Today ---
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // --- Year ---
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    try {
        // Total orders for today
        const todayOrders = await Order.countDocuments({
            vendor: vendorId,
            createdAt: { $gte: startOfToday, $lte: endOfToday },
            orderStatus: { $in: ['In-process', 'Completed'] }
        });

        // Total orders for this year
        const yearlyOrdersResult = await Order.aggregate([
            { 
                $match: { 
                    vendor: vendorId,
                    createdAt: { $gte: startOfYear, $lte: endOfYear },
                    orderStatus: { $in: ['In-process', 'Completed'] }
                } 
            },
            { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$totalPrice' } } }
        ]);
        const yearlyOrders = yearlyOrdersResult[0]?.totalOrders || 0;
        const yearlyRevenue = yearlyOrdersResult[0]?.totalRevenue || 0;

        // Monthly orders (array of 12 months)
        const monthlyOrdersResult = await Order.aggregate([
            { 
                $match: { 
                    vendor: vendorId,
                    createdAt: { $gte: startOfYear, $lte: endOfYear },
                    orderStatus: { $in: ['In-process', 'Completed'] }
                } 
            },
            { 
                $group: { 
                    _id: { month: { $month: '$createdAt' } }, 
                    count: { $sum: 1 }, 
                    revenue: { $sum: '$totalPrice' } 
                } 
            },
            { $sort: { '_id.month': 1 } }
        ]);

        const monthlyOrders = Array.from({ length: 12 }, (_, i) => {
            const monthData = monthlyOrdersResult.find(m => m._id.month === i + 1);
            return monthData ? { orders: monthData.count, revenue: monthData.revenue } : { orders: 0, revenue: 0 };
        });

        res.status(200).json({
            success: true,
            data: {
                todayOrders,
                yearlyOrders,
                yearlyRevenue,
                monthlyOrders
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch vendor order stats',
            error: error.message
        });
    }
});



const getMonthlyOrders = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const { year } = req.query; // Allow filtering by year

    const currentYear = parseInt(year) || new Date().getFullYear();

    try {
        const monthlyOrders = await Order.aggregate([
            {
                $match: {
                    vendor: vendorId,
                    createdAt: {
                        $gte: new Date(`${currentYear}-01-01T00:00:00Z`),
                        $lt: new Date(`${currentYear + 1}-01-01T00:00:00Z`),
                    },
                },
            },
            {
                $group: {
                    _id: { month: { $month: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { '_id.month': 1 } },
        ]);

        res.status(200).json({ success: true, data: monthlyOrders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch monthly order data.', error: error.message });
    }
});




const getRecentListings = asyncHandler(async (req, res) => {
    const vendorId = req.user._id; // only this vendor's products
    const { category, search } = req.query;

    let filter = {
        status: 'In Stock',
        vendor: vendorId
    };

    if (category && category !== 'All') {
        filter.category = category;
    }

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    const products = await Product.find(filter)
        .sort({ datePosted: -1 })
        .limit(20);

    res.status(200).json({
        success: true,
        count: products.length,
        products,
    });
});


const getRecentVendorOrders = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;

    try {
        const recentOrders = await Order.find({ vendor: vendorId })
            .populate('buyer', 'name email')
            .sort({ createdAt: -1 })
            .limit(5); // You can adjust the limit as needed

        res.status(200).json({ success: true, data: recentOrders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch recent orders.', error: error.message });
    }
});


const getTodaysOrders = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    try {
        const todaysOrders = await Order.find({
            vendor: vendorId,
            createdAt: { $gte: startOfToday }
        })
        // ✅ buyer info (name + mobile)
        .populate('buyer', 'name mobileNumber')
        // ✅ product info (name + variety)
        .populate('products.product', 'name variety')
        .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: todaysOrders });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch today\'s orders.', 
            error: error.message 
        });
    }
});



// -------------------------------
// Product Management
// -------------------------------

// @desc    Get all products for the logged-in vendor
// @route   GET /api/vendor/products
// @access  Private/Vendor
const getVendorProducts = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const products = await Product.find({ vendor: vendorId });
    res.json({ success: true, count: products.length, data: products });
});


// @desc    Add a new product
// @route   POST /api/vendor/products/add
// @access  Private/Vendor
const addProduct = asyncHandler(async (req, res) => {
    const {
        name,
        category,
        variety,
        price,
        quantity,
        unit,
        description,
        weightPerPiece,
        allIndiaDelivery
    } = req.body;

    const vendorId = req.user._id;

    // --- 1. Vendor Approval Check ---
    const vendor = await User.findById(vendorId);
    if (!vendor || !vendor.isApproved) {
        return res.status(403).json({
            success: false,
            message: 'Your account is not approved. Cannot add products.'
        });
    }

    // --- 2. Mandatory Field Validation ---
    if (!name || !category || !variety || !price || !quantity || !unit) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields.'
        });
    }

    if (isNaN(price) || isNaN(quantity) || Number(price) <= 0 || Number(quantity) <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Price and Quantity must be valid positive numbers.'
        });
    }

    // --- 3. Validation for "pc" unit ---
    if (unit === 'pc' && (!weightPerPiece || typeof weightPerPiece !== 'string')) {
        return res.status(400).json({
            success: false,
            message: 'When selling by piece (pc), you must specify the weight per piece (e.g., "400g").'
        });
    }

    // --- 4. Upload Product Images to Cloudinary ---
    let images = [];
    if (req.files && req.files.length > 0) {
        try {
            for (const file of req.files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'product-images'
                });
                images.push(result.secure_url);
            }
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: 'Image upload failed. Please try again.',
                error: err.message
            });
        }
    } else {
        return res.status(400).json({
            success: false,
            message: 'At least one product image is required.'
        });
    }

    // --- 5. Create Product in Database ---
    const isAllIndiaDelivery =
        allIndiaDelivery === 'true' || allIndiaDelivery === true;

    const newProduct = await Product.create({
        name: name.trim(),
        vendor: vendorId,
        category: category.trim(),
        variety: variety.trim(),
        price: Number(price),
        quantity: Number(quantity),
        unit: unit.trim(),
        description: description?.trim() || 'No description provided.',
        images,
        allIndiaDelivery: isAllIndiaDelivery,
        status: 'In Stock',
        weightPerPiece: unit === 'pc' ? weightPerPiece : null
    });

    // --- 6. Respond ---
    res.status(201).json({
        success: true,
        message: 'Product added successfully.',
        data: newProduct
    });
});





// @desc    Update an existing product
// @route   PUT /api/vendor/products/:id
// @access  Private/Vendor
const updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // 1️⃣ Find Product
    const product = await Product.findById(id);
    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // 2️⃣ Authorization Check
    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized to update this product.' });
    }

    // 3️⃣ Allowed Fields (basic)
    const allowedFields = [
        'name',
        'category',
        'variety',
        'price',
        'quantity',
        'unit',
        'description',
        'status',
        'weightPerPiece',
        'allIndiaDelivery'
    ];

    const updateFields = {};

    // 4️⃣ Process Field Updates
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            // Convert price/quantity to number
            if (field === 'price' || field === 'quantity') {
                updateFields[field] = Number(updates[field]);
            }
            // Boolean conversion for allIndiaDelivery
            else if (field === 'allIndiaDelivery') {
                updateFields[field] =
                    updates[field] === true || updates[field] === 'true';
            }
            // Trim strings for clean input
            else if (typeof updates[field] === 'string') {
                updateFields[field] = updates[field].trim();
            } else {
                updateFields[field] = updates[field];
            }
        }
    }

    // 5️⃣ Validation for "pc" unit (if changed or exists)
    const finalUnit = updateFields.unit || product.unit;
    if (finalUnit === 'pc') {
        const weight = updateFields.weightPerPiece || product.weightPerPiece;
        if (!weight || typeof weight !== 'string') {
            return res.status(400).json({
                success: false,
                message:
                    'When selling by piece (pc), you must specify the weight per piece (e.g., "400g").'
            });
        }
        updateFields.weightPerPiece = weight;
    } else {
        // If unit is not 'pc', remove any existing weightPerPiece
        updateFields.weightPerPiece = null;
    }

    // 6️⃣ Handle Image Uploads (if provided)
    if (req.files && req.files.length > 0) {
        try {
            const uploadedImages = [];
            for (const file of req.files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: 'product-images'
                });
                uploadedImages.push(result.secure_url);
            }
            // Replace all images (frontend should handle preserving old URLs)
            updateFields.images = uploadedImages;
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Image upload failed.',
                error: error.message
            });
        }
    }

    // 7️⃣ Update the Product
    const updatedProduct = await Product.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
    );

    // 8️⃣ Response
    res.status(200).json({
        success: true,
        message: 'Product updated successfully.',
        data: updatedProduct
    });
});



const getProductById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Validate Product ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid product ID.'
        });
    }

    // 2️⃣ Find Product + Vendor Details
    const product = await Product.findById(id)
        .populate({
            path: 'vendor',
            select: 'name mobileNumber email address vendorDetails.about profilePicture'
        })
        .lean();

    // 3️⃣ Product Not Found
    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found.'
        });
    }

    // 4️⃣ Construct Clean Response
    const responseData = {
        _id: product._id,
        name: product.name,
        category: product.category,
        variety: product.variety,
        description: product.description,
        price: product.price,
        quantity: product.quantity,
        unit: product.unit,
        weightPerPiece: product.weightPerPiece || null,
        allIndiaDelivery: product.allIndiaDelivery,
        images: product.images,
        status: product.status,
        vendor: product.vendor
            ? {
                  name: product.vendor.name,
                  about: product.vendor.vendorDetails?.about || '',
                  mobileNumber: product.vendor.mobileNumber,
                  email: product.vendor.email || '',
                  address:
                      product.vendor.address ||
                      product.vendor.vendorDetails?.address ||
                      null,
                  profilePicture: product.vendor.profilePicture || ''
              }
            : null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
    };

    // 5️⃣ Send Response
    res.status(200).json({
        success: true,
        message: 'Product fetched successfully.',
        data: responseData
    });
});





// @desc    Delete a product
// @route   DELETE /api/vendor/products/:id
// @access  Private/Vendor
const deleteProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Validate Product ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid product ID.'
        });
    }

    // 2️⃣ Find Product
    const product = await Product.findById(id);

    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found.'
        });
    }

    // 3️⃣ Check Authorization
    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            success: false,
            message: 'You are not authorized to delete this product.'
        });
    }

    // 4️⃣ (Optional) Delete Product Images from Cloudinary
    if (product.images && product.images.length > 0) {
        for (const imageUrl of product.images) {
            try {
                const publicId = imageUrl.split('/').pop().split('.')[0]; // extract Cloudinary public ID
                await cloudinary.uploader.destroy(`product-images/${publicId}`);
            } catch (err) {
                console.error('Cloudinary image deletion failed:', err.message);
            }
        }
    }

    // 5️⃣ Delete Product from DB
    await Product.findByIdAndDelete(id);

    // 6️⃣ Respond
    res.status(200).json({
        success: true,
        message: 'Product deleted successfully.'
    });
});


// @desc    Update product stock/status
// @route   PUT /api/vendor/products/:id/status
// @access  Private/Vendor
const updateProductStatus = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    product.status = req.body.status;
    const updatedProduct = await product.save();

    res.json({
        success: true,
        message: 'Product status updated',
        data: updatedProduct,
    });
});

// -------------------------------
// Order Management
// -------------------------------

// @desc    Get all orders for the logged-in vendor
// @route   GET /api/vendor/orders
// @access  Private/Vendor
const getVendorOrders = asyncHandler(async (req, res) => {
    const orders = await Order.find({ vendor: req.user._id })
        .populate('buyer', 'name email mobileNumber')           // only bring buyer details you need
        .populate('products.product', 'name price mobileNumber variety'); // populate product details inside products array

    res.json({ success: true, data: orders });
});



// @desc    Update an order's status
// @route   PUT /api/vendor/orders/:id/update-status
// @access  Private/Vendor
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;

    // Find the order and ensure orderStatus is included
    const order = await Order.findById(req.params.id)
        .populate('products.product')
        .select('+orderStatus'); // include orderStatus if it's normally excluded

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    order.orderStatus = status;
    const updatedOrder = await order.save();

    // Send full document including orderStatus
    res.json({
        success: true,
        message: 'Order status updated',
        data: updatedOrder,
    });
});




const getVendorProductsByCategory = asyncHandler(async (req, res) => {
  try {
    const vendorId = req.user._id; // vendor logged in
    const { category } = req.params; // category from dropdown (fruits, vegetables, etc.)

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: "Vendor authentication required.",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required in URL (e.g., /vendor/products/fruits).",
      });
    }

    // ✅ Supported categories (capitalized as stored in DB)
    const allowedCategories = ['Fruits', 'Vegetables', 'Plants', 'Seeds', 'Handicrafts'];

    // Find matching category in DB ignoring case
    const matchedCategory = allowedCategories.find(
      (cat) => cat.toLowerCase() === category.toLowerCase()
    );

    if (!matchedCategory) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Choose one of: ${allowedCategories.join(", ")}.`,
      });
    }

    // ✅ Fetch products for this vendor & category (case-insensitive)
    const products = await Product.find({
      vendor: vendorId,
      category: { $regex: new RegExp(`^${matchedCategory}$`, 'i') }, // case-insensitive
    })
      .select("name price images stock status unit variety")
      .sort({ createdAt: -1 });

    // ✅ Response
    res.status(200).json({
      success: true,
      total: products.length,
      category: matchedCategory,
      data: products,
    });
  } catch (error) {
    console.error("Error fetching vendor products by category:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while fetching vendor products.",
    });
  }
});





// -------------------------------
// Coupon Management
// -------------------------------

// @desc    Get coupons for the logged-in vendor
// @route   GET /api/vendor/coupons
// @access  Private/Vendor

// @desc    Get a single coupon by ID
// @route   GET /api/vendor/coupons/:id
// @access  Private/Vendor
const getVendorCouponById = asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    // Ensure the logged-in vendor owns this coupon
    if (coupon.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, data: coupon });
});



const createCoupon = asyncHandler(async (req, res) => {
    const {
        code,
        discountValue, 
        discountType = 'Percentage',
        minimumOrder = 0,
        usageLimitPerUser = 1,
        totalUsageLimit,
        startDate, 
        expiryDate, 
        appliesTo, // Can be: "All Products", ["Fruits", "Vegetables"], or "Specific Product"
        productIds = [], 
        status = 'Active'
    } = req.body;
    
    const creatorId = req.user._id;

    // --- 1. Basic Validation ---
    if (!code || !discountValue || !startDate || !expiryDate) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    if (await Coupon.findOne({ code: code.toUpperCase() })) {
        return res.status(400).json({ success: false, message: 'Coupon code already exists.' });
    }

    const start = new Date(startDate);
    const expiry = new Date(expiryDate);
    if (expiry <= start) {
        return res.status(400).json({ success: false, message: 'Expiry date must be after the Start date.' });
    }

    // --- 2. Determine applicable products ---
    let finalApplicableProductIds = [];
    let isUniversal = false;

    // Case 1: All Products
    if (appliesTo === 'All Products') {
        isUniversal = true;
    } 
    // Case 2: Multiple categories (array)
    else if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        if (!productIds || productIds.length === 0) {
            return res.status(400).json({ success: false, message: 'You must select at least one product.' });
        }

        const productsInVendor = await Product.find({
            _id: { $in: productIds },
            vendor: creatorId,
            category: { $in: appliesTo }
        }).select('_id');

        if (productsInVendor.length !== productIds.length) {
            return res.status(403).json({ success: false, message: 'Selected products must belong to your account and chosen categories.' });
        }

        finalApplicableProductIds = productsInVendor.map(p => p._id);
    } 
    // Case 3: Specific Product
    else if (appliesTo === 'Specific Product' && productIds.length === 1) {
        const product = await Product.findOne({ _id: productIds[0], vendor: creatorId });
        if (!product) return res.status(403).json({ success: false, message: 'You can only apply coupons to your own products.' });
        finalApplicableProductIds = [product._id];
    } 
    else {
        return res.status(400).json({ success: false, message: 'Invalid selection for coupon applicability.' });
    }

    // --- 3. Create and Save Coupon ---
    const newCoupon = await Coupon.create({
        code: code.toUpperCase(),
        discount: { value: parseFloat(discountValue), type: discountType },
        appliesTo,
        applicableProducts: isUniversal ? [] : finalApplicableProductIds,
        startDate: start,
        expiryDate: expiry,
        minimumOrder: parseFloat(minimumOrder) || 0,
        usageLimitPerUser,
        totalUsageLimit,
        vendor: creatorId,
        createdBy: creatorId,
        status
    });

    res.status(201).json({
        success: true,
        message: 'Coupon created successfully.',
        data: newCoupon
    });
});









const getVendorCoupons = asyncHandler(async (req, res) => {
  const vendorId = req.user?._id;
  if (!vendorId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Vendor information missing.'
    });
  }

  const { search = '', status } = req.query;

  // --- Build query ---
  const query = { vendor: vendorId };

  // Filter by status
  const allowedStatuses = ['Active', 'Expired', 'Disabled'];
  if (status && allowedStatuses.includes(status)) {
    query.status = status;
  }

  // Search by coupon code (case-insensitive)
  if (search.trim()) {
    query.code = { $regex: search.trim(), $options: 'i' };
  }

  // Fetch all matching coupons (no pagination)
  const coupons = await Coupon.find(query)
    .sort({ createdAt: -1 })
    .populate({
      path: 'applicableProducts', // populate products if any
      select: 'name category price'
    });

  res.status(200).json({
    success: true,
    count: coupons.length,
    data: coupons
  });
});

module.exports = { getVendorCoupons };







// Update a coupon
const updateVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid coupon ID.' });
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    if (coupon.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to update this coupon.' });
    }

    const {
        code,
        discount,
        appliesTo,
        productIds,
        minimumOrder,
        usageLimitPerUser,
        status,
        totalUsageLimit,
        startDate,
        expiryDate,
        category
    } = req.body;

    // --- 1. Update basic fields ---
    if (code) coupon.code = code.toUpperCase();
    if (discount && typeof discount === 'object') {
        coupon.discount.value = discount.value ?? coupon.discount.value;
        coupon.discount.type = discount.type ?? coupon.discount.type;
    }
    if (minimumOrder !== undefined) coupon.minimumOrder = parseFloat(minimumOrder);
    if (usageLimitPerUser !== undefined) coupon.usageLimitPerUser = usageLimitPerUser;
    if (totalUsageLimit !== undefined) coupon.totalUsageLimit = totalUsageLimit;
    if (status) coupon.status = status;
    if (category) coupon.category = category;
    if (startDate) coupon.startDate = new Date(startDate);
    if (expiryDate) coupon.expiryDate = new Date(expiryDate);

    // --- 2. Handle appliesTo field ---
    if (appliesTo !== undefined) {
        // Case: Array of categories
        if (Array.isArray(appliesTo) && appliesTo.length > 0) {
            if (!productIds || productIds.length === 0) {
                return res.status(400).json({ success: false, message: 'You must select at least one product.' });
            }

            const productsInVendor = await Product.find({
                _id: { $in: productIds },
                vendor: req.user._id,
                category: { $in: appliesTo }
            }).select('_id');

            if (productsInVendor.length !== productIds.length) {
                return res.status(403).json({ success: false, message: 'Selected products must belong to your account and chosen categories.' });
            }

            coupon.appliesTo = appliesTo;
            coupon.applicableProducts = productsInVendor.map(p => p._id);
        }
        // Case: Single string (like "All Products" or "Specific Product")
        else if (typeof appliesTo === 'string') {
            coupon.appliesTo = appliesTo;
            if (appliesTo === 'All Products') {
                coupon.applicableProducts = [];
            }
            // If Specific Product, expect exactly one productId
            else if (appliesTo === 'Specific Product' && productIds?.length === 1) {
                const product = await Product.findOne({ _id: productIds[0], vendor: req.user._id });
                if (!product) {
                    return res.status(403).json({ success: false, message: 'You can only apply coupons to your own product.' });
                }
                coupon.applicableProducts = [product._id];
            }
        } else {
            return res.status(400).json({ success: false, message: 'Invalid appliesTo value.' });
        }
    }

    // --- 3. Save and return updated coupon ---
    try {
        const updatedCoupon = await coupon.save();
        res.status(200).json({
            success: true,
            message: 'Coupon updated successfully.',
            data: updatedCoupon
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            message: 'Failed to update coupon.',
            error: err.message
        });
    }
});






const deleteVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const vendorId = req.user._id;

    // --- 1. Validate coupon ID ---
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid or missing coupon ID.' });
    }

    // --- 2. Fetch the coupon ---
    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    // --- 3. Authorization check ---
    if (coupon.vendor.toString() !== vendorId.toString()) {
        return res.status(403).json({ success: false, message: 'You are not authorized to delete this coupon.' });
    }

    // --- 4. Delete coupon ---
    await Coupon.findByIdAndDelete(id);

    res.status(200).json({
        success: true,
        message: 'Coupon deleted successfully.',
        data: { couponId: id, code: coupon.code }
    });
});









// -------------------------------
// Vendor Profile & Settings
// -------------------------------

// @desc    Get vendor profile details
// @route   GET /api/vendor/profile
// @access  Private/Vendor



const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('-password'); 
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Ensure vendorDetails exists to safely access 'about'
    const vendorDetails = user.vendorDetails || {};

    const responseData = {
        id: user._id,
        name: user.name,
        mobileNumber: user.mobileNumber,
        profilePicture: user.profilePicture,
        role: user.role,
        upiId: user.upiId,
        address: user.address,
        language: user.language,
        about: vendorDetails.about || '' // now safe and always returns string
    };

    // Include extra vendor info if role is Vendor
    if (user.role === 'Vendor') {
        responseData.totalOrdersAsBuyer = user.totalOrdersAsBuyer || 0;
    }

    res.status(200).json({ success: true, user: responseData });
});




// @desc    Update User/Vendor Profile
// @route   PUT /api/user/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
    const { name, mobileNumber, upiId, about } = req.body;

    // 1️⃣ Find User
    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // 2️⃣ Validate Mandatory Fields
    if (!name || !mobileNumber || !upiId) {
        return res.status(400).json({
            success: false,
            message: 'Name, Mobile Number, and UPI Id are mandatory fields.'
        });
    }

    // Optional: Mobile number validation (10 digits)
    if (!/^\d{10}$/.test(mobileNumber)) {
        return res.status(400).json({
            success: false,
            message: 'Mobile number must be a valid 10-digit number.'
        });
    }

    // 3️⃣ Handle Profile Picture Upload
    if (req.file) {
        try {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'profile-images',
            });
            user.profilePicture = result.secure_url;
        } catch (err) {
            console.error('Cloudinary error:', err);
            return res.status(500).json({ success: false, message: 'Image upload failed.' });
        }
    }

    // 4️⃣ Update Text Fields
    user.name = name;
    user.mobileNumber = mobileNumber;
    user.upiId = upiId;

    // Vendor About (ensure vendorDetails exists)
    user.vendorDetails = user.vendorDetails || {};
    user.vendorDetails.about = about || user.vendorDetails.about;

    // 5️⃣ Handle Address Update
    if (req.body.address) {
        try {
            user.address = typeof req.body.address === 'string'
                ? JSON.parse(req.body.address)
                : req.body.address;
        } catch (e) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address format. Must be valid JSON.'
            });
        }
    }

    // 6️⃣ Save User
    const updatedUser = await user.save();

    // 7️⃣ Respond
    res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
            id: updatedUser._id,
            name: updatedUser.name,
            mobileNumber: updatedUser.mobileNumber,
            profilePicture: updatedUser.profilePicture,
            upiId: updatedUser.upiId,
            address: updatedUser.address,
            about: updatedUser.vendorDetails?.about || ''
        }
    });
});

module.exports = { updateUserProfile };







const uploadProfileImage = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }

    // Upload image to Cloudinary and update user's profile
    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'profile-images' });
    user.profilePicture = result.secure_url;

    await user.save();
    res.status(200).json({ success: true, message: 'Profile image updated.', imageUrl: result.secure_url });
});

// @desc    Change password
// @route   POST /api/vendor/change-password
// @access  Private/Vendor
const changePassword = asyncHandler(async (req, res) => {
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = password; // must hash in User model pre-save hook
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
});




/**
 * @desc    Updates the authenticated user's address and GeoJSON location.
 * GeoJSON coordinates (latitude/longitude) are optional.
 * @route   PUT /api/user/profile/location
 * @access  Private (Authenticated User/Vendor)
 */
const updateLocationDetails = asyncHandler(async (req, res) => {
  const { 
    pinCode, 
    houseNumber, 
    locality, 
    city, 
    district, 
    latitude, 
    longitude,
    deliveryRegion
  } = req.body;

  // Validate mandatory fields
  if (!pinCode || !houseNumber || !locality || !city || !district) {
    return res.status(400).json({ success: false, message: 'All address fields are required.' });
  }

  // Parse deliveryRegion as number
  const region = parseFloat(deliveryRegion);
  if (isNaN(region) || region <= 0) {
    return res.status(400).json({ success: false, message: 'Delivery Region must be a positive number.' });
  }

  const updateFields = {
    'address.pinCode': pinCode,
    'address.houseNumber': houseNumber,
    'address.locality': locality,
    'address.city': city,
    'address.district': district,
    'vendorDetails.deliveryRegion': region
  };

  // Parse latitude/longitude as numbers
  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Invalid latitude or longitude.' });
    }

    updateFields['address.latitude'] = lat;
    updateFields['address.longitude'] = lng;
    updateFields['location'] = { type: 'Point', coordinates: [lng, lat] };
  } else {
    updateFields['location'] = undefined;
  }

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updateFields },
    { new: true, runValidators: true }
  ).select('-password');

  if (!updatedUser) {
    return res.status(404).json({ success: false, message: 'Vendor not found.' });
  }

  res.status(200).json({
    success: true,
    message: 'Location and delivery details updated successfully.',
    data: {
        address: {
            ...updatedUser.address,
            latitude: Number(updatedUser.address.latitude),
            longitude: Number(updatedUser.address.longitude)
        },
        location: updatedUser.location,
        deliveryRegion: `${Number(updatedUser.vendorDetails?.deliveryRegion || 0)} km` // ✅ append " km"
    }
});

});

const getVendorLocationDetails = asyncHandler(async (req, res) => {
    // Ensure the user is a Vendor (though route middleware should enforce this)
    if (req.user.role !== 'Vendor') {
        return res.status(403).json({ success: false, message: 'Access denied. Must be a vendor.' });
    }

    // Fetch the vendor and select the required fields
    const vendor = await User.findById(req.user._id).select('name address location vendorDetails');

    if (!vendor) {
        return res.status(404).json({ success: false, message: 'Vendor profile not found.' });
    }

    res.status(200).json({
    success: true,
    data: {
        // Address fields
        address: vendor.address || null,
        // GeoJSON location
        location: vendor.location || null,
        // Delivery settings with " km" appended
        deliveryRegion: vendor.vendorDetails?.deliveryRegion 
            ? `${Number(vendor.vendorDetails.deliveryRegion)} km` 
            : null
    }
});

});

const updateUserLanguage = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    user.language = req.body.language || user.language;
    await user.save();
    res.status(200).json({ success: true, message: 'Language updated successfully.', language: user.language });
});

const getStaticPageContent = asyncHandler(async (req, res) => {
    const pageName = req.params.pageName;
    const page = await StaticPage.findOne({ pageName: pageName });
    if (!page) {
        return res.status(404).json({ success: false, message: 'Page not found.' });
    }
    res.status(200).json({ success: true, page });
});

const reportUserIssue = asyncHandler(async (req, res) => {
    const { title, description } = req.body;
    if (!title || !description) {
        return res.status(400).json({ success: false, message: 'Title and description are required.' });
    }
    const photos = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'issue-reports' });
            photos.push(result.secure_url);
        }
    }
    const newIssue = new Issue({
        userId: req.user._id,
        title,
        description,
        photos
    });
    await newIssue.save();
    res.status(201).json({ success: true, message: 'Issue reported successfully.' });
});

// @desc    Logout
// @route   POST /api/vendor/logout
// @access  Private/Vendor
const logout = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = {
    getDashboardData,
    getVendorProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    updateProductStatus,
    getVendorOrders,
    updateOrderStatus,
    getVendorCoupons,
    getVendorCouponById,       // <-- add this
    createCoupon,
    updateVendorCoupon,
    deleteVendorCoupon,
    getUserProfile,
    updateUserProfile,
    getRecentListings,
    getProductById,getVendorLocationDetails,
    changePassword,getVendorProductsByCategory,
    logout,
    uploadProfileImage,
    updateLocationDetails,   // <-- missing
    updateUserLanguage,
    updateOrderStatus,
    getMonthlyOrders,
    getRecentVendorOrders,getTodaysOrders,getVendorDashboardAnalytics,getVendorOrderStats
};

