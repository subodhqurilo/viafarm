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
        name, category, variety, price, quantity, unit, description,
        allIndiaDelivery // Removed nutritionalValue
    } = req.body;
    
    const vendorId = req.user._id; 

    // 1. Mandatory Input Validation (Matching the '*' fields in Figma)
    if (!name || !category || !variety || !price || !quantity || !unit) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required fields: Name, Category, Variety, Price, Quantity, and Unit are mandatory.' 
        });
    }

    if (isNaN(price) || isNaN(quantity) || Number(price) <= 0 || Number(quantity) <= 0) {
        return res.status(400).json({
            success: false, 
            message: 'Price and Quantity must be valid positive numbers.'
        });
    }

    // 2. Image Upload to Cloudinary (Mandatory requirement from the form text)
    let images = [];
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, {
                folder: 'product-images',
            });
            images.push(result.secure_url);
        }
    } else {
        return res.status(400).json({ 
            success: false, 
            message: 'At least one product image is required.' 
        });
    }

    // 3. Prepare Boolean Field
    const isAllIndiaDelivery = (allIndiaDelivery === true || allIndiaDelivery === 'true');

    // 4. Create Product in Database
    const newProduct = await Product.create({
        name,
        vendor: vendorId,
        category,
        variety,
        price: Number(price),
        quantity: Number(quantity),
        unit,
        description: description || '',
        images,
        // Nutritional value is omitted as it is handled via a separate PUT/POST request later
        allIndiaDelivery: isAllIndiaDelivery,
        status: 'In Stock' // Default status upon creation
    });

    res.status(201).json({
        success: true,
        message: 'Product added successfully',
        data: newProduct,
    });
});


// @desc    Update an existing product
// @route   PUT /api/vendor/products/:id
// @access  Private/Vendor
const updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    // 1. Authorization Check (Find the product first)
    const product = await Product.findById(id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Ensure the user updating the product is the vendor who owns it
    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized to update this product.' });
    }

    // Prepare an object to hold updates
    const updateFields = {};

    // 2. Update Basic Fields
    const allowedFields = ['name', 'category', 'variety', 'price', 'quantity', 'unit', 'description', 'status'];
    allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
            // Convert price and quantity to Number explicitly for safety
            updateFields[field] = (field === 'price' || field === 'quantity') ? Number(updates[field]) : updates[field];
        }
    });

    // 3. Handle allIndiaDelivery (Boolean conversion)
    if (updates.allIndiaDelivery !== undefined) {
        // Convert string ('true'/'false') or boolean to boolean
        const isAllIndiaDelivery = (updates.allIndiaDelivery === true || updates.allIndiaDelivery === 'true');
        updateFields.allIndiaDelivery = isAllIndiaDelivery;
    }
    
    // 4. Handle Image Replacement (If files are uploaded)
    if (req.files && req.files.length > 0) {
        const uploadedImages = [];
        // First, upload new images
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'product-images' });
            uploadedImages.push(result.secure_url);
        }
        // NOTE: This logic replaces ALL existing images.
        // For partial updates, the frontend should send the existing URLs along with new files.
        updateFields.images = uploadedImages; 
    }
    
    // 5. Apply Updates using findByIdAndUpdate
    const updatedProduct = await Product.findByIdAndUpdate(
        id, 
        { $set: updateFields },
        { new: true, runValidators: true } // Return the new document and enforce schema rules
    );

    res.json({
        success: true,
        message: 'Product updated successfully',
        data: updatedProduct,
    });
});


const getProductById = asyncHandler(async (req, res) => {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const product = await Product.findById(id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, data: product });
});




// @desc    Delete a product
// @route   DELETE /api/vendor/products/:id
// @access  Private/Vendor
const deleteProduct = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Product removed successfully' });
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
    if (coupon.vendor.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, data: coupon });
});


const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    discount,
    appliesTo,
    startDate,
    expiryDate,
    minimumOrder = 0,
    totalUsageLimit = 0,
    usageLimitPerUser = 1,
    applicableId = null,
    appliesToRef = null,
    category = null,
    status = 'Active'
  } = req.body;

  // ✅ Validate required fields
  if (
    !code ||
    !discount ||
    !discount.value ||
    !discount.type ||
    !appliesTo ||
    !startDate ||
    !expiryDate
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Please fill all required fields: code, discount(value/type), appliesTo, startDate, expiryDate.'
    });
  }

  // ✅ Check duplicate coupon code
  const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (existingCoupon) {
    return res.status(400).json({
      success: false,
      message: 'Coupon code already exists.'
    });
  }

  // ✅ Create new coupon
  const newCoupon = await Coupon.create({
    code: code.toUpperCase(),
    discount: {
      value: discount.value,
      type: discount.type
    },
    appliesTo,
    applicableId,
    appliesToRef,
    category,
    startDate: new Date(startDate),
    expiryDate: new Date(expiryDate),
    minimumOrder,
    totalUsageLimit,
    usageLimitPerUser,
    vendor: req.user._id,
    createdBy: req.user._id,
    status
  });

  res.status(201).json({
    success: true,
    message: 'Coupon created successfully.',
    data: newCoupon
  });
});



const getVendorCoupons = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Vendor information missing.'
    });
  }

  const coupons = await Coupon.find({ vendor: req.user._id })
    .sort({ createdAt: -1 });

  if (!coupons || coupons.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'No coupons found for this vendor.',
      data: []
    });
  }

  res.status(200).json({
    success: true,
    count: coupons.length,
    data: coupons
  });
});





// Update a coupon
const updateVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ success: false, message: 'Invalid coupon ID.' });
    }

    const coupon = await Coupon.findById(id);

    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    if (coupon.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to update this coupon.' });
    }

    const allowedFields = [
        'code', 'discount', 'appliesTo', 'minimumOrder', 'usageLimitPerUser', 'status', 
        'startDate', 'expiryDate', 'applicableId', 'appliesToRef', 'category'
    ];

    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
            // Special handling for discount object
            if (field === 'discount' && typeof req.body.discount === 'object') {
                coupon.discount.value = req.body.discount.value ?? coupon.discount.value;
                coupon.discount.type = req.body.discount.type ?? coupon.discount.type;
            } 
            else if (field === 'startDate' || field === 'expiryDate') {
                coupon[field] = new Date(req.body[field]);
            } 
            else if (field === 'code') {
                coupon.code = req.body.code.toUpperCase();
            } 
            else {
                coupon[field] = req.body[field];
            }
        }
    });

    const updatedCoupon = await coupon.save();

    res.status(200).json({
        success: true,
        message: 'Coupon updated successfully.',
        data: updatedCoupon
    });
});


const deleteVendorCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({ success: false, message: 'Invalid coupon ID.' });
  }

  const coupon = await Coupon.findById(id);

  if (!coupon) {
    return res.status(404).json({ success: false, message: 'Coupon not found.' });
  }

  if (coupon.vendor.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized to delete this coupon.' });
  }

  await Coupon.findByIdAndDelete(id);

  res.status(200).json({ success: true, message: 'Coupon deleted successfully.' });
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
        longitude 
    } = req.body;

    // --- 1. Address Validation (Fields from the UI are required for an address update) ---
    // If the user is updating location, they must provide the core address fields.
    if (!pinCode || !houseNumber || !locality || !city || !district) {
        return res.status(400).json({ success: false, message: 'All address fields (Pin Code, House Number, Locality, City, District) are required.' });
    }

    // --- 2. Build Update Object ---
    const updateFields = {
        'address.pinCode': pinCode,
        'address.houseNumber': houseNumber,
        'address.locality': locality,
        'address.city': city,
        'address.district': district,
    };
    
    // --- 3. Handle GeoJSON Location (Optional Update) ---
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
        // Clear location if not provided in the request body, 
        // ensuring old coordinates don't persist if the user only updates address text.
        updateFields['location'] = undefined;
    }
    
    // --- 4. Update and Validate ---
    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updateFields },
        { new: true, runValidators: true } // Return new document and enforce schema rules
    );

    if (!updatedUser) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // --- 5. Response ---
    res.status(200).json({
        success: true,
        message: 'Location updated successfully.',
        address: updatedUser.address,
        location: updatedUser.location
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
    getProductById,
    changePassword,
    logout,
    uploadProfileImage,
    updateLocationDetails,   // <-- missing
    updateUserLanguage,
    updateOrderStatus,
    getMonthlyOrders,
    getRecentVendorOrders,getTodaysOrders,getVendorDashboardAnalytics,getVendorOrderStats
};

