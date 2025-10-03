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

        // Total revenue from completed orders
        const totalRevenueResult = await Order.aggregate([
            { $match: { vendor: vendorId, status: 'Completed' } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);
        const totalRevenue = totalRevenueResult[0]?.total || 0;

        // Total orders for today
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
                totalRevenue,
                todayOrders,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard data.', error: error.message });
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
        .populate('buyer', 'name')
        .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: todaysOrders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch today\'s orders.', error: error.message });
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
        nutritionalValue, allIndiaDelivery
    } = req.body;

    // Upload images to Cloudinary
    let images = [];
    if (req.files) {
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, {
                folder: 'product-images',
            });
            images.push(result.secure_url);
        }
    }

    const newProduct = await Product.create({
        name,
        vendor: req.user._id,
        category,
        variety,
        price,
        quantity,
        unit,
        description,
        images, // store array of URLs
        nutritionalValue: typeof nutritionalValue === 'string' ? JSON.parse(nutritionalValue) : nutritionalValue,
        allIndiaDelivery: typeof allIndiaDelivery === 'string' ? JSON.parse(allIndiaDelivery) : allIndiaDelivery,
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
    const product = await Product.findById(req.params.id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (product.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // Handle nutritionalValue
    if (req.body.nutritionalValue) {
        try {
            product.nutritionalValue =
                typeof req.body.nutritionalValue === 'string'
                    ? JSON.parse(req.body.nutritionalValue)
                    : req.body.nutritionalValue;
        } catch (err) {
            return res.status(400).json({ success: false, message: 'Invalid nutritionalValue JSON' });
        }
    }

    // Handle allIndiaDelivery
    if (req.body.allIndiaDelivery !== undefined) {
        if (typeof req.body.allIndiaDelivery === 'string') {
            product.allIndiaDelivery = req.body.allIndiaDelivery.toLowerCase() === 'true';
        } else {
            product.allIndiaDelivery = !!req.body.allIndiaDelivery;
        }
    }

    // Update other allowed fields
    const allowedFields = ['name', 'category', 'variety', 'price', 'quantity', 'unit', 'description'];
    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) product[field] = req.body[field];
    });

    // Handle multiple image uploads
    if (req.files && req.files.length > 0) {
        const uploadedImages = [];
        for (const file of req.files) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'product-images' });
            uploadedImages.push(result.secure_url);
        }
        product.images = uploadedImages;
    }

    const updatedProduct = await product.save();

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
        .populate('buyer', 'name email')           // only bring buyer details you need
        .populate('products.product', 'name price'); // populate product details inside products array

    res.json({ success: true, data: orders });
});



// @desc    Update an order's status
// @route   PUT /api/vendor/orders/:id/update-status
// @access  Private/Vendor
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;

    // 1. Find the order
    const order = await Order.findById(req.params.id).populate('products.product');

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 2. Check if vendor is authorized
    if (order.vendor.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // 3. Update orderStatus
    order.orderStatus = status; // ✅ use orderStatus
    const updatedOrder = await order.save();

    // 4. Respond with updated order
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


// Get coupons for the logged-in vendor
const getVendorCoupons = asyncHandler(async (req, res) => {
    const coupons = await Coupon.find({ vendor: new mongoose.Types.ObjectId(req.user.id) });
    res.json({ success: true, data: coupons });
});

// Create a new coupon
const createCoupon = asyncHandler(async (req, res) => {
    const {
        code,
        discount,
        appliesTo,
        validFrom,
        validTill,
        minimumOrder,
        usageLimit
    } = req.body;

    if (!code || !discount || !validFrom || !validTill || !appliesTo) {
        return res.status(400).json({
            success: false,
            message: 'Please fill all required fields',
        });
    }

    const existing = await Coupon.findOne({ code });
    if (existing) {
        return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    const newCoupon = await Coupon.create({
        code,
        discount,
        appliesTo,
        validFrom,
        validTill,
        minimumOrder,
        usageLimit,
        vendor: new mongoose.Types.ObjectId(req.user.id),    // Correctly convert to ObjectId
        createdBy: new mongoose.Types.ObjectId(req.user.id) // Correctly convert to ObjectId
    });

    res.status(201).json({
        success: true,
        message: 'Coupon created successfully',
        data: newCoupon,
    });
});

// Update a coupon
const updateVendorCoupon = asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    if (coupon.vendor.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const allowedFields = [
        'code', 'discount', 'appliesTo', 'validFrom',
        'validTill', 'minimumOrder', 'usageLimit', 'status'
    ];

    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) coupon[field] = req.body[field];
    });

    const updatedCoupon = await coupon.save();
    res.status(200).json({
        success: true,
        message: 'Coupon updated successfully.',
        data: updatedCoupon
    });
});

// Delete a coupon
const deleteVendorCoupon = asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found.' });

    if (coupon.vendor.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await coupon.remove();
    res.status(200).json({ success: true, message: 'Coupon deleted successfully.' });
});



// -------------------------------
// Vendor Profile & Settings
// -------------------------------

// @desc    Get vendor profile details
// @route   GET /api/vendor/profile
// @access  Private/Vendor



const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('-password'); // always _id
    console.log(user)
    if (user) {
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                mobileNumber: user.mobileNumber,
                profilePicture: user.profilePicture,
                role: user.role,
                upiId: user.upiId,
                address: user.address,
                language: user.language

            }
        });
    } else {
        res.status(404).json({ success: false, message: 'User not found.' });
    }
});

const updateUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Update profile image if uploaded
    if (req.file) {
        try {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'profile-images'
            });
            user.profilePicture = result.secure_url;
        } catch (err) {
            console.error('Cloudinary error:', err);
            return res.status(500).json({ success: false, message: 'Image upload failed.' });
        }
    }

    // Update other fields
    if (req.body.name) user.name = req.body.name;
    if (req.body.mobileNumber) user.mobileNumber = req.body.mobileNumber;
    if (req.body.upiId) user.upiId = req.body.upiId;
    if (req.body.address) {
        user.address = typeof req.body.address === 'string'
            ? JSON.parse(req.body.address)
            : req.body.address;
    }


    const updatedUser = await user.save();

    res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
            id: updatedUser._id,
            name: updatedUser.name,
            mobileNumber: updatedUser.mobileNumber,
            profilePicture: updatedUser.profilePicture,
            upiId: updatedUser.upiId,
            address: user.address,


        }
    });
});





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


const updateUserLocation = asyncHandler(async (req, res) => {
    const { pinCode, houseNumber, locality, city, district, latitude, longitude } = req.body;

    if (!pinCode || !houseNumber || !locality || !city || !district || !latitude || !longitude) {
        return res.status(400).json({
            success: false,
            message: 'All fields including latitude & longitude are required.'
        });
    }

    try {
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            {
                $set: {
                    'address.pinCode': pinCode,
                    'address.houseNumber': houseNumber,
                    'address.locality': locality,
                    'address.city': city,
                    'address.district': district,
                    'address.latitude': latitude,
                    'address.longitude': longitude,
                    'location.coordinates': [parseFloat(longitude), parseFloat(latitude)]
                }
            },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        res.status(200).json({
            success: true,
            message: 'Location updated successfully.',
            address: updatedUser.address,
            location: updatedUser.location
        });

    } catch (error) {
        console.error('Error updating user location:', error);
        res.status(500).json({ success: false, message: 'Server error. Could not update location.' });
    }
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
    updateUserLocation,   // <-- missing
    updateUserLanguage,
    updateOrderStatus,
    getMonthlyOrders,
    getRecentVendorOrders,getTodaysOrders
};

