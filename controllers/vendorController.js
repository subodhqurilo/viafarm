const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Category = require('../models/Category');
const { upload, cloudinary } = require('../services/cloudinaryService');
const Coupon = require('../models/Coupon');
const Address = require('../models/Address');
const Notification = require('../models/Notification');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');

const { createAndSendNotification } = require('../utils/notificationUtils');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();



const getDashboardData = asyncHandler(async (req, res) => {
    try {
        const vendorId = req.user._id;

        // Define today's start and end timestamps
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        // 1️⃣ Total Orders (All-Time)
        const totalOrders = await Order.countDocuments({ vendor: vendorId });

        // 2️⃣ Total Revenue (All-Time)
        const totalRevenueAllResult = await Order.aggregate([
            { $match: { vendor: vendorId } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);
        const totalRevenueAll = totalRevenueAllResult[0]?.total || 0;

        // 3️⃣ Total Completed (Delivered) Revenue
        const totalRevenueCompletedResult = await Order.aggregate([
            { $match: { vendor: vendorId, orderStatus: "Completed", } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);
        const totalRevenueCompleted = totalRevenueCompletedResult[0]?.total || 0;

        // 4️⃣ Today's Orders Count
        const todayOrders = await Order.countDocuments({
            vendor: vendorId,
            createdAt: { $gte: startOfToday, $lte: endOfToday },
            orderStatus: {
                $in: ["Confirmed", "Delivered", 'In-process',

                    'Out For Delivery',
                    'Cancelled',
                    'Ready For Pickup',
                    'Completed',]
            },
        });

        // 5️⃣ Today's Revenue
        const todayRevenueResult = await Order.aggregate([
            {
                $match: {
                    vendor: vendorId,
                    createdAt: { $gte: startOfToday, $lte: endOfToday },
                    orderStatus: {
                        $in: ['Delivered',
                            'Confirmed',
                            'Completed',]
                    },
                },
            },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);
        const todayRevenue = todayRevenueResult[0]?.total || 0;

        // ✅ Response
        res.status(200).json({
            success: true,
            data: {
                totalOrders,
                totalRevenueAll: Number(totalRevenueAll.toFixed(2)),
                totalRevenueCompleted: Number(totalRevenueCompleted.toFixed(2)),
                todayOrders,
                todayRevenue: Number(todayRevenue.toFixed(2)),
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data.",
            error: error.message,
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
            .populate('products.product', 'name variety unit ')
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


const getVendorProducts = asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const products = await Product.find({ vendor: vendorId });
    res.json({ success: true, count: products.length, data: products });
});




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
        allIndiaDelivery,
    } = req.body;

    const vendorId = req.user._id;

    // 1️⃣ Verify vendor approval
    const vendor = await User.findById(vendorId);
    if (!vendor || !vendor.isApproved) {
        return res.status(403).json({
            success: false,
            message: "Your account is not approved. You cannot add products yet.",
        });
    }

    // 2️⃣ Validate required fields
    if (!name || !category || !variety || !price || !quantity || !unit) {
        return res.status(400).json({
            success: false,
            message: "Please fill in all required fields.",
        });
    }

    // 3️⃣ Validate numeric values
    if (isNaN(price) || isNaN(quantity) || price <= 0 || quantity <= 0) {
        return res.status(400).json({
            success: false,
            message: "Price and Quantity must be positive numeric values.",
        });
    }

    // 4️⃣ Validate “pc” unit requirement
    if (unit === "pc" && (!weightPerPiece || typeof weightPerPiece !== "string")) {
        return res.status(400).json({
            success: false,
            message:
                'When selling by piece (pc), please specify weight per piece (e.g., "400g").',
        });
    }

    // 5️⃣ Upload images to Cloudinary
    let images = [];
    if (req.files && req.files.length > 0) {
        try {
            for (const file of req.files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: "product-images",
                });
                images.push(result.secure_url);
            }
        } catch (err) {
            console.error("Cloudinary upload error:", err);
            return res.status(500).json({
                success: false,
                message: "Image upload failed. Please try again.",
            });
        }
    } else {
        return res.status(400).json({
            success: false,
            message: "At least one product image is required.",
        });
    }

    // 6️⃣ Create product in database
    const isAllIndiaDelivery =
        allIndiaDelivery === "true" || allIndiaDelivery === true;

    const newProduct = await Product.create({
        name: name.trim(),
        vendor: vendorId,
        category: category.trim(),
        variety: variety.trim(),
        price: Number(price),
        quantity: Number(quantity),
        unit: unit.trim(),
        description: description?.trim() || "No description provided.",
        images,
        allIndiaDelivery: isAllIndiaDelivery,
        status: "In Stock",
        weightPerPiece: unit === "pc" ? weightPerPiece : null,
    });

    // 7️⃣ 🔔 Notifications

    // 👨‍💼 Admin (personal notification)
    await createAndSendNotification(
        req,
        "🆕 New Product Added",
        `${vendor.name} just added a new product "${newProduct.name}".`,
        {
            productId: newProduct._id,
            vendorId,
            category,
            price,
            quantity,
        },
        "Admin" // All Admin users
    );

    // 🧑‍🌾 Vendor (personal confirmation)
    await createAndSendNotification(
        req,
        "✅ Product Added Successfully",
        `Your product "${newProduct.name}" has been added successfully and is now in stock.`,
        {
            productId: newProduct._id,
            category,
            price,
        },
        "Vendor",
        vendorId // Personal vendor ID
    );

    // 8️⃣ Send Response
    res.status(201).json({
        success: true,
        message: "Product added successfully and notifications sent.",
        data: newProduct,
    });
});


const updateProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // 1️⃣ Find product
    const product = await Product.findById(id);
    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // 2️⃣ Vendor Authorization
    if (product.vendor.toString() !== req.user._id.toString()) {
        return res
            .status(401)
            .json({ success: false, message: "Not authorized to update this product." });
    }

    // 3️⃣ Define allowed fields
    const allowedFields = [
        "name",
        "category",
        "variety",
        "price",
        "quantity",
        "unit",
        "description",
        "status",
        "weightPerPiece",
        "allIndiaDelivery",
    ];

    const updateFields = {};

    // 4️⃣ Validate and prepare updates
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            if (field === "price" || field === "quantity") {
                updateFields[field] = Number(updates[field]);
            } else if (field === "allIndiaDelivery") {
                updateFields[field] =
                    updates[field] === true || updates[field] === "true";
            } else if (typeof updates[field] === "string") {
                updateFields[field] = updates[field].trim();
            } else {
                updateFields[field] = updates[field];
            }
        }
    }

    // 5️⃣ Validation for “pc” unit
    const finalUnit = updateFields.unit || product.unit;
    if (finalUnit === "pc") {
        const weight = updateFields.weightPerPiece || product.weightPerPiece;
        if (!weight || typeof weight !== "string") {
            return res.status(400).json({
                success: false,
                message:
                    'When selling by piece (pc), please specify "weightPerPiece" (e.g., "400g").',
            });
        }
        updateFields.weightPerPiece = weight;
    } else {
        updateFields.weightPerPiece = null;
    }

    // 6️⃣ Handle image upload (optional)
    if (req.files && req.files.length > 0) {
        try {
            const uploadedImages = [];
            for (const file of req.files) {
                const result = await cloudinary.uploader.upload(file.path, {
                    folder: "product-images",
                });
                uploadedImages.push(result.secure_url);
            }
            updateFields.images = uploadedImages;
        } catch (error) {
            console.error("Cloudinary upload error:", error);
            return res.status(500).json({
                success: false,
                message: "Image upload failed.",
                error: error.message,
            });
        }
    }

    // --- Save old price before updating ---
    const oldPrice = product.price;

    // 7️⃣ Update product in DB
    const updatedProduct = await Product.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
    ).populate("vendor", "name _id");

    // 8️⃣ 🔔 Notifications

    // 🧑‍🌾 Vendor (personal)
    await createAndSendNotification(
        req,
        "✅ Product Updated",
        `Your product "${updatedProduct.name}" was updated successfully.`,
        {
            productId: updatedProduct._id,
            newPrice: updatedProduct.price,
            oldPrice,
        },
        "Vendor",
        updatedProduct.vendor._id
    );

    // 🛒 Buyers (only if price dropped)
    if (
        updateFields.price !== undefined &&
        Number(updateFields.price) < Number(oldPrice)
    ) {
        await createAndSendNotification(
            req,
            "💰 Price Drop Alert!",
            `Good news! "${updatedProduct.name}" is now ₹${updateFields.price} (was ₹${oldPrice}). Hurry up before stock runs out!`,
            {
                productId: updatedProduct._id,
                oldPrice,
                newPrice: updateFields.price,
            },
            "Buyer" // 👈 sends to all buyers
        );
    }

    // ✅ 9️⃣ Final response
    res.status(200).json({
        success: true,
        message: "Product updated successfully.",
        data: updatedProduct,
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



const updateProductStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // 1️⃣ Find Product
    const product = await Product.findById(id).populate("vendor", "name _id");
    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // 2️⃣ Vendor Authorization
    if (product.vendor._id.toString() !== req.user._id.toString()) {
        return res.status(401).json({ success: false, message: "Not authorized to update this product." });
    }

    // 3️⃣ Update Product Status
    product.status = status;
    const updatedProduct = await product.save();

    // 4️⃣ 🔔 Send Notifications

    // 👨‍💼 Admin Notification
    await createAndSendNotification(
        req,
        "Product Status Updated",
        `${product.vendor.name} changed the status of "${updatedProduct.name}" to "${status}".`,
        {
            productId: updatedProduct._id,
            vendorId: product.vendor._id,
            status,
        },
        "Admin" // ✅ Notify all admins
    );

    // 🛒 Buyer Notification (Broadcast)
    let message = "";
    if (status === "In Stock") {
        message = `Good news! "${updatedProduct.name}" is now back in stock. Shop now!`;
    } else if (status === "Out of Stock" || status === "Inactive") {
        message = `Heads up! "${updatedProduct.name}" is now out of stock.`;
    } else {
        message = `The status of "${updatedProduct.name}" has been updated to "${status}".`;
    }

    await createAndSendNotification(
        req,
        "Product Availability Update",
        message,
        {
            productId: updatedProduct._id,
            status,
        },
        "Buyer" // ✅ Notify all buyers
    );

    // 5️⃣ Response
    res.status(200).json({
        success: true,
        message: "Product status updated and notifications sent.",
        data: updatedProduct,
    });
});


const getVendorOrders = asyncHandler(async (req, res) => {
    const orders = await Order.find({ vendor: req.user._id })
        .populate('buyer', 'name email mobileNumber')           // only bring buyer details you need
        .populate('products.product', 'name price mobileNumber quantity unit variety'); // populate product details inside products array

    res.json({ success: true, data: orders });
});



const updateOrderStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;

    // 1️⃣ Find the order
    const order = await Order.findById(req.params.id)
        .populate("products.product buyer vendor", "name _id email");

    if (!order) {
        return res.status(404).json({
            success: false,
            message: "Order not found.",
        });
    }

    // 2️⃣ Authorization: Only vendor who owns this order can update
    if (order.vendor._id.toString() !== req.user._id.toString()) {
        return res.status(401).json({
            success: false,
            message: "Not authorized to update this order.",
        });
    }

    // 3️⃣ Update status
    order.orderStatus = status;
    const updatedOrder = await order.save();

    // 4️⃣ 🔔 Send Notifications
    try {
        // 🧍‍♂️ Personal Buyer Notification
        await createAndSendNotification(
            req,
            "Order Status Updated",
            `Your order (${order._id}) status has been updated to "${status}".`,
            {
                orderId: order._id,
                status,
                vendorId: order.vendor._id,
                vendorName: order.vendor.name,
            },
            "Buyer",
            order.buyer._id // 🎯 personal buyer
        );

        // (Optional) 👨‍💼 Notify Admin — if you ever want to log status changes
        /*
        await createAndSendNotification(
          req,
          "Order Status Changed by Vendor",
          `${order.vendor.name} updated order (${order._id}) status to "${status}".`,
          {
            orderId: order._id,
            buyerId: order.buyer._id,
            vendorId: order.vendor._id,
            status,
          },
          "Admin"
        );
        */
    } catch (err) {
        console.error("❌ Notification sending failed:", err.message);
    }

    // 5️⃣ Prepare response (rename orderStatus → status)
    const responseOrder = updatedOrder.toObject();
    responseOrder.status = responseOrder.orderStatus;
    delete responseOrder.orderStatus;

    // ✅ Final Response
    res.status(200).json({
        success: true,
        message: `Order status updated to "${status}" and buyer notified.`,
        data: responseOrder,
    });
});





const updateUserStatus = asyncHandler(async (req, res) => {
    const { status } = req.body; // Expected: "Active" or "Inactive"
    const userId = req.user._id; // Vendor's ID from token

    // 1️⃣ Validate status
    if (!status || !["Active", "Inactive"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid status. Must be Active or Inactive.",
        });
    }

    // 2️⃣ Update vendor status
    const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: { status } },
        { new: true, runValidators: true }
    ).select("name role status mobileNumber");

    if (!updatedUser) {
        return res
            .status(404)
            .json({ success: false, message: "User not found." });
    }

    // 3️⃣ 🔔 Send Notifications

    // 👨‍💼 Notify Admin
    await createAndSendNotification(
        req,
        "Vendor Status Changed",
        `${updatedUser.name} (${updatedUser.mobileNumber}) has changed their status to "${status}".`,
        {
            vendorId: updatedUser._id,
            vendorName: updatedUser.name,
            status,
        },
        "Admin" // Notify all Admins
    );

    // 🧍‍♂️ Notify All Buyers
    let buyerMessage =
        status === "Active"
            ? `${updatedUser.name}'s store is now active again! You can browse their products.`
            : `${updatedUser.name}'s store is now inactive temporarily.`;

    await createAndSendNotification(
        req,
        "Vendor Status Update",
        buyerMessage,
        {
            vendorId: updatedUser._id,
            vendorName: updatedUser.name,
            status,
        },
        "Buyer" // Notify all buyers
    );

    // 4️⃣ ✅ Send Response
    res.status(200).json({
        success: true,
        message: `Your status has been updated to ${status}, and notifications sent to Admin and Buyers.`,
        data: updatedUser,
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


// Coupon Management


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
        discountType = "Percentage", // Default
        minimumOrder = 0,
        usageLimitPerUser = 1,
        totalUsageLimit,
        startDate,
        expiryDate,
        appliesTo,
        productIds = [],
        status = "Active",
    } = req.body;

    const creatorId = req.user._id;

    // 1️⃣ Validate required fields
    if (!code || !discountValue || !startDate || !expiryDate) {
        return res.status(400).json({
            success: false,
            message:
                "Missing required fields (code, discountValue, startDate, expiryDate).",
        });
    }

    // 2️⃣ Validate discount type
    if (!["Fixed", "Percentage"].includes(discountType)) {
        return res.status(400).json({
            success: false,
            message: "Invalid discountType. Must be 'Fixed' or 'Percentage'.",
        });
    }

    // 3️⃣ Check duplicate code
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
        return res.status(400).json({
            success: false,
            message: "Coupon code already exists.",
        });
    }

    // 4️⃣ Validate date range
    const start = new Date(startDate);
    const expiry = new Date(expiryDate);
    if (expiry <= start) {
        return res.status(400).json({
            success: false,
            message: "Expiry date must be after the Start date.",
        });
    }

    // 5️⃣ Determine applicable products
    let finalApplicableProductIds = [];
    let isUniversal = false;

    if (appliesTo === "All Products") {
        isUniversal = true;
    } else if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        if (!productIds || productIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "You must select at least one product.",
            });
        }

        const productsInVendor = await Product.find({
            _id: { $in: productIds },
            vendor: creatorId,
            category: { $in: appliesTo },
        }).select("_id");

        if (productsInVendor.length !== productIds.length) {
            return res.status(403).json({
                success: false,
                message:
                    "Selected products must belong to your account and chosen categories.",
            });
        }

        finalApplicableProductIds = productsInVendor.map((p) => p._id);
    } else if (appliesTo === "Specific Product" && productIds.length === 1) {
        const product = await Product.findOne({
            _id: productIds[0],
            vendor: creatorId,
        });
        if (!product) {
            return res.status(403).json({
                success: false,
                message: "You can only apply coupons to your own products.",
            });
        }
        finalApplicableProductIds = [product._id];
    } else {
        return res.status(400).json({
            success: false,
            message: "Invalid selection for coupon applicability.",
        });
    }

    // 6️⃣ Create the coupon
    const newCoupon = await Coupon.create({
        code: code.toUpperCase(),
        discount: {
            value: parseFloat(discountValue),
            type: discountType, // only one — validated above
        },
        appliesTo,
        applicableProducts: isUniversal ? [] : finalApplicableProductIds,
        startDate: start,
        expiryDate: expiry,
        minimumOrder: parseFloat(minimumOrder) || 0,
        usageLimitPerUser,
        totalUsageLimit,
        vendor: creatorId,
        createdBy: creatorId,
        status,
    });

    // 7️⃣ 🔔 Send Notifications
    try {
        // 👨‍💼 Notify Admin(s)
        await createAndSendNotification(
            req,
            "New Coupon Created",
            `Vendor ${req.user.name || "A vendor"} created a new coupon "${newCoupon.code}".`,
            {
                couponId: newCoupon._id,
                vendorId: creatorId,
                discountValue,
                discountType,
            },
            "Admin"
        );

        // 🧍‍♂️ Notify Vendor (personal)
        await createAndSendNotification(
            req,
            "Coupon Created Successfully 🎉",
            `Your coupon "${newCoupon.code}" has been created successfully!`,
            {
                couponId: newCoupon._id,
                discountValue,
                discountType,
                expiryDate,
            },
            "Vendor",
            creatorId
        );

        // 👥 Notify All Buyers
        await createAndSendNotification(
            req,
            "New Coupon Available 🎟️",
            `A new coupon "${newCoupon.code}" is now live! Use it to get ${discountValue}${discountType === "Percentage" ? "%" : "₹"
            } off your next purchase.`,
            {
                couponId: newCoupon._id,
                discountValue,
                discountType,
                expiryDate,
            },
            "Buyer"
        );
    } catch (err) {
        console.error("❌ Notification sending failed:", err.message);
    }

    // 8️⃣ ✅ Response
    res.status(201).json({
        success: true,
        message:
            "Coupon created successfully and notifications sent to Admin, Vendor, and Buyers.",
        data: newCoupon,
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


// Update a coupon
const updateVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Validate Coupon ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid coupon ID." });
    }

    // 2️⃣ Find Coupon
    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({ success: false, message: "Coupon not found." });
    }

    // 3️⃣ Authorization Check
    if (coupon.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Not authorized to update this coupon." });
    }

    // 4️⃣ Keep track of old discount for price drop detection
    const oldDiscountValue = coupon.discount?.value;

    const {
        code,
        discount,
        appliesTo,
        productIds,
        minimumOrder,
        usageLimitPerUser,
        totalUsageLimit,
        startDate,
        expiryDate,
        status,
        category,
    } = req.body;

    // --- 5️⃣ Update Basic Fields ---
    if (code) coupon.code = code.toUpperCase();
    if (discount && typeof discount === "object") {
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

    // --- 6️⃣ Handle appliesTo logic ---
    if (appliesTo !== undefined) {
        if (Array.isArray(appliesTo) && appliesTo.length > 0) {
            if (!productIds || productIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "You must select at least one product.",
                });
            }

            const productsInVendor = await Product.find({
                _id: { $in: productIds },
                vendor: req.user._id,
                category: { $in: appliesTo },
            }).select("_id");

            if (productsInVendor.length !== productIds.length) {
                return res.status(403).json({
                    success: false,
                    message: "Selected products must belong to your account and chosen categories.",
                });
            }

            coupon.appliesTo = appliesTo;
            coupon.applicableProducts = productsInVendor.map((p) => p._id);
        } else if (typeof appliesTo === "string") {
            coupon.appliesTo = appliesTo;
            if (appliesTo === "All Products") {
                coupon.applicableProducts = [];
            } else if (appliesTo === "Specific Product" && productIds?.length === 1) {
                const product = await Product.findOne({
                    _id: productIds[0],
                    vendor: req.user._id,
                });
                if (!product) {
                    return res.status(403).json({
                        success: false,
                        message: "You can only apply coupons to your own product.",
                    });
                }
                coupon.applicableProducts = [product._id];
            }
        } else {
            return res.status(400).json({ success: false, message: "Invalid appliesTo value." });
        }
    }

    // --- 7️⃣ Save Updated Coupon ---
    const updatedCoupon = await coupon.save();

    // --- 8️⃣ Notifications ---
    try {
        // 👨‍💼 a. Notify Admin
        await createAndSendNotification(
            req,
            "Coupon Updated",
            `Vendor ${req.user.name || "A vendor"} updated coupon "${updatedCoupon.code}".`,
            {
                couponId: updatedCoupon._id,
                vendorId: req.user._id,
                discount: updatedCoupon.discount,
                status: updatedCoupon.status,
            },
            "Admin"
        );

        // 🧍‍♂️ b. Notify Vendor (personal)
        await createAndSendNotification(
            req,
            "Coupon Updated Successfully",
            `Your coupon "${updatedCoupon.code}" has been successfully updated.`,
            {
                couponId: updatedCoupon._id,
                discount: updatedCoupon.discount,
                expiryDate: updatedCoupon.expiryDate,
            },
            "Vendor",
            req.user._id
        );

        // 👥 c. Notify All Buyers only if discount value decreased (price drop)
        if (
            discount &&
            typeof discount.value === "number" &&
            discount.value > oldDiscountValue
        ) {
            // Lower discount means coupon became worse — skip
        } else if (
            discount &&
            typeof discount.value === "number" &&
            discount.value < oldDiscountValue
        ) {
            // Price drop: bigger discount percentage or value
            await createAndSendNotification(
                req,
                "Coupon Price Drop Alert 💸",
                `Good news! Coupon "${updatedCoupon.code}" now gives you ${updatedCoupon.discount.value}${updatedCoupon.discount.type === "Percentage" ? "%" : "₹"} OFF (was ${oldDiscountValue}${updatedCoupon.discount.type === "Percentage" ? "%" : "₹"}).`,
                {
                    couponId: updatedCoupon._id,
                    oldDiscount: oldDiscountValue,
                    newDiscount: updatedCoupon.discount.value,
                },
                "Buyer" // broadcast to all buyers
            );
        }
    } catch (err) {
        console.error("❌ Notification sending failed:", err);
    }

    // --- 9️⃣ Respond ---
    res.status(200).json({
        success: true,
        message: "Coupon updated successfully.",
        data: updatedCoupon,
    });
});


const deleteVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const vendorId = req.user._id;

    // 1️⃣ Validate coupon ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid or missing coupon ID.",
        });
    }

    // 2️⃣ Find coupon
    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({
            success: false,
            message: "Coupon not found.",
        });
    }

    // 3️⃣ Authorization check
    if (coupon.vendor.toString() !== vendorId.toString()) {
        return res.status(403).json({
            success: false,
            message: "You are not authorized to delete this coupon.",
        });
    }

    // 4️⃣ Delete coupon
    await Coupon.findByIdAndDelete(id);

    // 5️⃣ Notify only the vendor (personal)
    try {
        await createAndSendNotification(
            req,
            "Coupon Deleted Successfully 🗑️",
            `Your coupon "${coupon.code}" has been deleted successfully.`,
            {
                couponId: id,
                code: coupon.code,
            },
            "Vendor",
            vendorId // 🎯 Personal vendor notification
        );
    } catch (err) {
        console.error("Notification sending failed:", err);
    }

    // 6️⃣ Response
    res.status(200).json({
        success: true,
        message: `Coupon "${coupon.code}" deleted successfully.`,
        data: { couponId: id, code: coupon.code },
    });
});


const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // ✅ Ensure vendorDetails exists to safely access nested fields
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
        about: vendorDetails.about || '',
        status: user.status,
    };

    if (user.role === 'Vendor') {
        responseData.totalOrders = vendorDetails.totalOrders || 0;
        responseData.deliveryRegion = vendorDetails.deliveryRegion || 5;
        responseData.farmImages = vendorDetails.farmImages || []; // ✅ Correct access
    }

    if (user.role === 'Buyer') {
        responseData.totalOrdersAsBuyer = user.totalOrdersAsBuyer || 0;
    }

    res.status(200).json({ success: true, user: responseData });
});


const updateUserProfile = asyncHandler(async (req, res) => {
    console.log("🟢 Received body:", req.body);

    const { name, mobileNumber, upiId, about, status } = req.body;

    // 1️⃣ Find User
    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }

    // 2️⃣ Validation Checks
    if (!name || !mobileNumber || !upiId) {
        return res.status(400).json({
            success: false,
            message: "Name, Mobile Number, and UPI Id are mandatory fields.",
        });
    }

    if (!/^\d{10}$/.test(mobileNumber)) {
        return res.status(400).json({
            success: false,
            message: "Mobile number must be a valid 10-digit number.",
        });
    }

    // ✅ Prevent duplicate mobile numbers
    if (mobileNumber !== user.mobileNumber) {
        const existingUser = await User.findOne({ mobileNumber });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "This mobile number is already registered.",
            });
        }
    }

    // 3️⃣ Handle Profile Picture Upload (Single)
    if (req.files?.profileImage && req.files.profileImage[0]) {
        try {
            const result = await cloudinary.uploader.upload(req.files.profileImage[0].path, {
                folder: "profile-images",
            });
            user.profileImage = result.secure_url;
        } catch (err) {
            console.error("Cloudinary error:", err);
            return res.status(500).json({
                success: false,
                message: "Profile image upload failed.",
            });
        }
    }

    // 4️⃣ Handle Farm Images Upload (Multiple)
    if (req.files?.farmImages && req.files.farmImages.length > 0) {
        try {
            const uploads = await Promise.all(
                req.files.farmImages.map((file) =>
                    cloudinary.uploader.upload(file.path, { folder: "farm-images" })
                )
            );
            const farmImageUrls = uploads.map((u) => u.secure_url);
            user.vendorDetails = user.vendorDetails || {};
            user.vendorDetails.farmImages = farmImageUrls;
        } catch (err) {
            console.error("Cloudinary farm upload error:", err);
            return res.status(500).json({
                success: false,
                message: "Farm images upload failed.",
            });
        }
    }

    // 5️⃣ Update Basic Info
    user.name = name;
    user.mobileNumber = mobileNumber;
    user.upiId = upiId;

    // 6️⃣ Vendor About Info
    user.vendorDetails = user.vendorDetails || {};
    user.vendorDetails.about = about || user.vendorDetails.about;

    // 7️⃣ Handle Address Update
    if (req.body.address) {
        try {
            user.address =
                typeof req.body.address === "string"
                    ? JSON.parse(req.body.address)
                    : req.body.address;
        } catch (e) {
            return res.status(400).json({
                success: false,
                message: "Invalid address format. Must be valid JSON.",
            });
        }
    }

    // 8️⃣ Update User Status
    if (status) {
        const allowedStatuses = ["Active", "Inactive"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status. Allowed values: Active or Inactive.",
            });
        }
        user.status = status;
    }

    // 9️⃣ Save Updated User
    const updatedUser = await user.save();

    // 🔟 🔔 Send Personal Notification (Vendor only)
    if (updatedUser.role === "Vendor") {
        try {
            await createAndSendNotification(
                req,
                "Profile Updated Successfully 🛠️",
                `Hello ${updatedUser.name}, your vendor profile has been updated successfully.`,
                {
                    userId: updatedUser._id,
                    name: updatedUser.name,
                    mobileNumber: updatedUser.mobileNumber,
                    upiId: updatedUser.upiId,
                },
                "Vendor", // userType
                updatedUser._id // 🎯 personal vendor ID
            );
        } catch (err) {
            console.error("❌ Notification sending failed:", err);
        }
    }

    // ✅ 11️⃣ Response
    res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: {
            id: updatedUser._id,
            name: updatedUser.name,
            mobileNumber: updatedUser.mobileNumber,
            upiId: updatedUser.upiId,
            profilePicture: updatedUser.profileImage,
            farmImages: updatedUser.vendorDetails?.farmImages || [],
            address: updatedUser.address,
            about: updatedUser.vendorDetails?.about || "",
            status: updatedUser.status,
        },
    });
});


const uploadProfileImage = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!req.file) {
        return res
            .status(400)
            .json({ success: false, message: "No image file uploaded." });
    }

    // 1️⃣ Upload image to Cloudinary
    let result;
    try {
        result = await cloudinary.uploader.upload(req.file.path, {
            folder: "profile-images",
        });
    } catch (err) {
        console.error("Cloudinary upload failed:", err);
        return res
            .status(500)
            .json({ success: false, message: "Image upload failed." });
    }

    // 2️⃣ Update user record
    user.profilePicture = result.secure_url;
    await user.save();

    // 3️⃣ ✅ Send Personal Notification to the same Vendor/User
    try {
        await createAndSendNotification(
            req,
            "Profile Picture Updated",
            "Your profile picture has been updated successfully.",
            { userId: user._id, imageUrl: result.secure_url },
            "Vendor",
            user._id // 👈 Personal notification
        );
    } catch (err) {
        console.error("Notification sending failed:", err);
    }

    // 4️⃣ Send Response
    res.status(200).json({
        success: true,
        message: "Profile image updated.",
        imageUrl: result.secure_url,
    });
});

const changePassword = asyncHandler(async (req, res) => {
    const { password, confirmPassword } = req.body;

    // 1️⃣ Validate Input
    if (!password || !confirmPassword) {
        return res
            .status(400)
            .json({ success: false, message: "Both password fields are required." });
    }

    if (password !== confirmPassword) {
        return res
            .status(400)
            .json({ success: false, message: "Passwords do not match." });
    }

    // 2️⃣ Find User
    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }

    // 3️⃣ Update Password (auto-hashed via pre-save hook)
    user.password = password;
    await user.save();

    // 4️⃣ 🔔 Send Personal Notification
    await createAndSendNotification(
        req,
        "Password Changed",
        "Your password has been changed successfully.",
        { userId: user._id },
        "Vendor", // or "User" based on your role system
        user._id  // 👈 Send only to this specific user
    );

    // 5️⃣ Send Response
    res.json({
        success: true,
        message: "Password updated successfully.",
    });
});


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

    // --- 1. Validation ---
    if (!pinCode || !houseNumber || !locality || !city || !district) {
        return res.status(400).json({ success: false, message: 'All address fields are required.' });
    }

    // Parse deliveryRegion as number
    const region = parseFloat(deliveryRegion);
    if (isNaN(region) || region <= 0) {
        return res.status(400).json({ success: false, message: 'Delivery Region must be a positive number.' });
    }

    // --- 2. Build Update Object ---
    const updateFields = {
        // Update Address sub-document
        'address.pinCode': pinCode,
        'address.houseNumber': houseNumber,
        'address.locality': locality,
        'address.city': city,
        'address.district': district,

        // Update delivery region in vendorDetails sub-document
        'vendorDetails.deliveryRegion': region
    };

    // --- 3. Handle GeoJSON Location (Mandatory for Near You feature) ---
    if (latitude && longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ success: false, message: 'Invalid latitude or longitude.' });
        }

        // Store latitude and longitude directly in the address for easy access (optional, but good for UI)
        updateFields['address.latitude'] = lat;
        updateFields['address.longitude'] = lng;

        updateFields['location'] = { type: 'Point', coordinates: [lng, lat] };
    } else {
        updateFields['location'] = undefined;
        updateFields['address.latitude'] = undefined; // Clear if not provided
        updateFields['address.longitude'] = undefined;
    }

    // --- 4. Update and Respond ---
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
            address: updatedUser.address,
            location: updatedUser.location,
            deliveryRegion: `${Number(updatedUser.vendorDetails?.deliveryRegion || 0)} km` // Append " km" for clean response
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


const logout = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = {
    getDashboardData, updateUserStatus,
    getVendorProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    updateProductStatus,
    getVendorOrders,
    updateOrderStatus,
    getVendorCoupons,
    getVendorCouponById,
    createCoupon,
    updateVendorCoupon,
    deleteVendorCoupon,
    getUserProfile,
    updateUserProfile,
    getRecentListings,
    getProductById, getVendorLocationDetails,
    changePassword, getVendorProductsByCategory,
    logout,
    uploadProfileImage,
    updateLocationDetails,
    updateUserLanguage,
    updateOrderStatus,
    getMonthlyOrders,
    getRecentVendorOrders, getTodaysOrders, getVendorDashboardAnalytics, getVendorOrderStats
};

