const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Category = require('../models/Category');
const Cart = require("../models/Cart");
const Wishlist = require("../models/Wishlist");
const { cloudinary, cloudinaryUpload, cloudinaryDestroy, upload } = require('../services/cloudinaryService');
const mongoose = require('mongoose');
const NotificationSettings = require('../models/NotificationSettings');
const CustomerSupport = require('../models/CustomerSupport');
const StaticPage = require('../models/StaticPage');
const { createAndSendNotification } = require('../utils/notificationUtils');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');
const axios = require('axios');

const Notification = require('../models/Notification');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const Address = require('../models/Address');


const calculateChange = (current, previous) => {
    if (previous === 0) return current === 0 ? 0 : 100;
    return ((current - previous) / previous) * 100;
};

// Format the change into a readable string (e.g., "+12%" or "-8%")
const formatChange = (value) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${value.toFixed(1)}%`;
};


const getDashboardStats = asyncHandler(async (req, res) => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // 1️⃣ Vendors (Active)
    const activeVendors = await User.countDocuments({ role: 'Vendor', status: 'Active' });
    const activeVendorsPrevious = await User.countDocuments({
        role: 'Vendor',
        status: 'Active',
        createdAt: { $lt: oneMonthAgo },
    });

    // 2️⃣ Buyers (Active)
    const activeBuyers = await User.countDocuments({ role: 'Buyer', status: 'Active' });
    const activeBuyersPrevious = await User.countDocuments({
        role: 'Buyer',
        status: 'Active',
        createdAt: { $lt: oneMonthAgo },
    });

    // 3️⃣ Products (In Stock)
    const activeProducts = await Product.countDocuments({ status: 'In Stock' });
    const activeProductsPrevious = await Product.countDocuments({
        status: 'In Stock',
        createdAt: { $lt: oneMonthAgo },
    });

    // 4️⃣ Orders (Confirmed or In Process)
    const orderFilter = { orderStatus: { $in: ['Confirmed', 'In Process'] } };
    const activeOrders = await Order.countDocuments(orderFilter);
    const activeOrdersPrevious = await Order.countDocuments({
        ...orderFilter,
        createdAt: { $lt: oneMonthAgo },
    });

    // Helper: Build stat object
    const buildStat = (current, previous) => {
        const changeValue = calculateChange(current, previous);
        return {
            current,
            change: formatChange(changeValue),
            increased: current >= previous, // ✅ true if increased, false if decreased
        };
    };

    // Final Response Object
    const stats = {
        vendors: buildStat(activeVendors, activeVendorsPrevious),
        buyers: buildStat(activeBuyers, activeBuyersPrevious),
        products: buildStat(activeProducts, activeProductsPrevious),
        orders: buildStat(activeOrders, activeOrdersPrevious),
    };

    res.status(200).json({
        success: true,
        data: stats,
    });
});

const getRecentActivity = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const recentRegistrations = await User.find({ role: 'Buyer' })
        .select('name createdAt profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const totalCount = await User.countDocuments({ role: 'Buyer' });

    res.status(200).json({
        success: true,
        data: {
            activities: recentRegistrations,
            page,
            pages: Math.ceil(totalCount / limit),
            total: totalCount,
        },
    });
});

const getProducts = asyncHandler(async (req, res) => {
    const { q, category } = req.query;

    const query = {};

    // 🔍 Search by product name or vendor name
    if (q) {
        const matchingVendors = await User.find({
            role: "Vendor",
            name: { $regex: q, $options: "i" },
        }).select("_id");

        const vendorIds = matchingVendors.map((vendor) => vendor._id);

        query.$or = [
            { name: { $regex: q, $options: "i" } },
            { vendor: { $in: vendorIds } },
        ];
    }

    // 🏷️ Filter by category
    if (category) {
        query.category = { $regex: category, $options: "i" };
    }

    // 📦 Fetch all matching products
    const products = await Product.find(query)
        .populate("vendor", "name")
        .select("name category price unit createdAt")
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        total: products.length,
        data: products,
    });
});


const getAdminProductDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    const product = await Product.findById(id)
        .populate('vendor', 'name profilePicture address');

    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    res.status(200).json({
        success: true,
        data: {
            product
        }
    });
});

const addOrUpdateNutritionalValue = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { servingSize, nutrients, additionalNote } = req.body;

    // 1️⃣ Update Product nutritional details
    const product = await Product.findByIdAndUpdate(
        id,
        {
            nutritionalValue: { servingSize, nutrients, additionalNote },
        },
        { new: true, runValidators: true }
    ).populate("vendor", "name _id expoPushToken");

    if (!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found.",
        });
    }

    // 2️⃣ Initialize socket and online users
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // 3️⃣ Notification templates
    const vendorNotification = {
        title: "Product Updated by Admin 🧾",
        message: `Admin has updated nutritional information for your product "${product.name}".`,
        type: "info",
        receiver: product.vendor._id,
        sender: req.user._id,
        role: "Vendor",
    };

    const adminNotification = {
        title: "Update Successful ✅",
        message: `You successfully updated nutritional information for "${product.name}".`,
        type: "success",
        receiver: req.user._id,
        sender: req.user._id,
        role: "Admin",
    };

    // 4️⃣ Save notifications in DB
    await Notification.insertMany([
        { ...vendorNotification, relatedProduct: product._id },
        { ...adminNotification, relatedProduct: product._id },
    ]);

    // 5️⃣ Real-time socket notifications
    const vendorId = product.vendor?._id?.toString();
    const adminId = req.user._id.toString();

    // Vendor (web socket)
    if (vendorId && onlineUsers[vendorId]) {
        io.to(onlineUsers[vendorId].socketId).emit("notification", vendorNotification);
    }

    // Admin (web socket)
    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", adminNotification);
    }

    // 6️⃣ Send Expo Push Notification (for vendor mobile app)
    if (product.vendor?.expoPushToken && Expo.isExpoPushToken(product.vendor.expoPushToken)) {
        try {
            await expo.sendPushNotificationsAsync([
                {
                    to: product.vendor.expoPushToken,
                    sound: "default",
                    title: vendorNotification.title,
                    body: vendorNotification.message,
                    data: { productId: product._id },
                },
            ]);
        } catch (expoError) {
            console.error("Expo push send error:", expoError);
        }
    }

    // 7️⃣ Response
    res.status(200).json({
        success: true,
        message: "Nutritional value updated successfully and notifications sent.",
        data: product.nutritionalValue,
    });
});

const deleteProduct = asyncHandler(async (req, res) => {
    const productId = req.params.id;

    // 1️⃣ Find product before deleting
    const product = await Product.findById(productId).populate("vendor", "_id name expoPushToken");

    if (!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found.",
        });
    }

    // 2️⃣ Delete product
    await product.deleteOne();

    // 3️⃣ Get io, online users, and Notification model
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // 4️⃣ Notify the vendor personally (DB + Socket + Expo)
    const vendorId = product.vendor?._id?.toString();
    if (vendorId) {
        const vendorNotification = {
            title: "Product Deleted 🗑️",
            message: `Admin has deleted your product "${product.name}".`,
            type: "warning",
            sender: req.user._id,
            receiver: vendorId,
            role: "Vendor",
            relatedProduct: product._id,
        };

        // Save in DB
        await Notification.create(vendorNotification);

        // Send real-time notification (Socket)
        if (onlineUsers[vendorId]) {
            io.to(onlineUsers[vendorId].socketId).emit("notification", vendorNotification);
        }

        // Send Expo Push Notification (Mobile App)
        if (product.vendor.expoPushToken && Expo.isExpoPushToken(product.vendor.expoPushToken)) {
            try {
                await expo.sendPushNotificationsAsync([
                    {
                        to: product.vendor.expoPushToken,
                        sound: "default",
                        title: vendorNotification.title,
                        body: vendorNotification.message,
                        data: { productId: product._id },
                    },
                ]);
            } catch (error) {
                console.error("Expo push error:", error);
            }
        }
    }

    // 5️⃣ Notify the admin (self confirmation)
    const adminId = req.user._id.toString();
    const adminNotification = {
        title: "Product Removed ✅",
        message: `You successfully deleted the product "${product.name}".`,
        type: "success",
        sender: adminId,
        receiver: adminId,
        role: "Admin",
        relatedProduct: product._id,
    };

    // Save in DB
    await Notification.create(adminNotification);

    // Send via socket (web)
    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", adminNotification);
    }

    // 6️⃣ Final API Response
    res.status(200).json({
        success: true,
        message: "Product removed successfully and notifications sent.",
    });
});






// @desc    Get all vendors for admin view
// @route   GET /api/admin/vendors
// @access  Private/Admin
const getVendors = asyncHandler(async (req, res) => {
    const { q, status } = req.query;

    const query = { role: 'Vendor' };

    // 🔍 Search by name
    if (q) {
        query.name = { $regex: q, $options: 'i' };
    }

    // ⚙️ Filter by status
    if (status) {
        query.status = status;
    }

    // ✅ Fetch all vendors (no pagination)
    const vendors = await User.find(query)
        .select('name address mobileNumber status profilePicture')
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        total: vendors.length,
        data: vendors.map(vendor => ({
            _id: vendor._id,
            name: vendor.name,
            mobileNumber: vendor.mobileNumber,
            status: vendor.status,
            profilePicture: vendor.profilePicture,
            address: vendor.address // Include full address object
        }))
    });
});




// @desc    Get details for a single vendor
// @route   GET /api/admin/vendor/:id
// @access  Private/Admin
// controllers/adminController.js
const getVendorDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Fetch vendor by ID
    const vendor = await User.findById(id)
        .select('name address mobileNumber profilePicture  status vendorDetails role rejectionReason'); // include rejectionReason

    if (!vendor || vendor.role !== 'Vendor') {
        return res.status(404).json({ success: false, message: 'Vendor not found.' });
    }

    // Fetch vendor's listed products
    const listedProducts = await Product.find({ vendor: id })
        .select('name category variety unit weightPerPiece quantity price status images createdAt')
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        data: {
            vendor: {
                _id: vendor._id,
                name: vendor.name,
                mobileNumber: vendor.mobileNumber,
                status: vendor.status,
                profilePicture: vendor.profilePicture,
                address: vendor.address,          // Full address object
                vendorDetails: vendor.vendorDetails,
                // Only include rejectionReason if vendor status is 'Rejected'
                ...(vendor.status === 'Reject' && { rejectionReason: vendor.rejectionReason || 'Not specified' }),
            },
            listedProducts
        }
    });
});


const updateVendorStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // Expected: 'Active', 'Blocked', 'UnBlocked', 'Inactive'

    const validStatuses = ["Active", "Blocked", "UnBlocked", "Inactive"];
    if (!validStatuses.includes(status)) {
        return res
            .status(400)
            .json({ success: false, message: "Invalid status provided." });
    }

    // 1️⃣ Update vendor's status
    const vendor = await User.findOneAndUpdate(
        { _id: id, role: "Vendor" },
        { status },
        { new: true, runValidators: true }
    ).select("_id name expoPushToken");

    if (!vendor) {
        return res
            .status(404)
            .json({ success: false, message: "Vendor not found." });
    }

    // 2️⃣ Update all their products based on vendor status
    if (status === "Blocked" || status === "Inactive") {
        await Product.updateMany({ vendor: id }, { status: "Inactive" });
    } else if (status === "Active") {
        await Product.updateMany(
            { vendor: id, status: "Inactive" },
            { status: "In Stock" }
        );
    }

    // 3️⃣ Socket and DB Notification setup
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // --- Vendor message ---
    let vendorMessage = "";
    let vendorType = "info";

    if (status === "Blocked")
        vendorMessage = "Your account has been blocked by the admin.";
    else if (status === "UnBlocked")
        vendorMessage = "Your account has been unblocked by the admin.";
    else if (status === "Inactive")
        vendorMessage = "Your account is now inactive.";
    else if (status === "Active")
        vendorMessage = "Your account has been activated by the admin.";

    // --- Save vendor notification in DB ---
    await Notification.create({
        title: "Account Status Update ⚙️",
        message: vendorMessage,
        type: vendorType,
        sender: req.user._id,
        receiver: vendor._id,
        role: "Vendor",
    });

    // --- Send Socket Notification (Web Real-time) ---
    if (onlineUsers[vendor._id]) {
        io.to(onlineUsers[vendor._id].socketId).emit("notification", {
            title: "Account Status Update ⚙️",
            message: vendorMessage,
            type: vendorType,
        });
    }

    // --- Send Push Notification (Expo App) ---
    if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
        try {
            await expo.sendPushNotificationsAsync([
                {
                    to: vendor.expoPushToken,
                    sound: "default",
                    title: "Account Status Update ⚙️",
                    body: vendorMessage,
                    data: { status },
                },
            ]);
        } catch (error) {
            console.error("Expo Push Error:", error);
        }
    }

    // --- Admin confirmation notification ---
    const adminId = req.user._id.toString();
    const adminMessage = `You updated ${vendor.name || "a vendor"}'s status to "${status}".`;

    await Notification.create({
        title: "Vendor Status Updated ✅",
        message: adminMessage,
        type: "success",
        sender: adminId,
        receiver: adminId,
        role: "Admin",
    });

    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", {
            title: "Vendor Status Updated ✅",
            message: adminMessage,
            type: "success",
        });
    }

    // 4️⃣ Final Response
    res.status(200).json({
        success: true,
        message: `Vendor status updated to ${status}.`,
        data: {
            vendorId: vendor._id,
            status: vendor.status,
        },
    });
});




const deleteVendor = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Soft delete vendor
    const vendor = await User.findOneAndUpdate(
        { _id: id, role: "Vendor" },
        { status: "Deleted" },
        { new: true }
    ).select("name _id expoPushToken");

    if (!vendor) {
        return res
            .status(404)
            .json({ success: false, message: "Vendor not found." });
    }

    // 2️⃣ Mark all their products inactive
    await Product.updateMany({ vendor: id }, { status: "Inactive" });

    // 3️⃣ Get socket and online users
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // 4️⃣ Prepare Notifications
    const vendorNotification = {
        title: "Account Deleted 🛑",
        message:
            "Your vendor account has been deleted by the admin. All your products are now inactive.",
        type: "error",
        sender: req.user._id,
        receiver: vendor._id,
        role: "Vendor",
    };

    const adminNotification = {
        title: "Vendor Deleted ✅",
        message: `You have successfully deleted vendor "${vendor.name}".`,
        type: "success",
        sender: req.user._id,
        receiver: req.user._id,
        role: "Admin",
    };

    // 5️⃣ Save notifications in DB
    await Notification.insertMany([vendorNotification, adminNotification]);

    // 6️⃣ Send Web (Socket) Notifications
    // --- To Vendor ---
    if (onlineUsers[vendor._id]) {
        io.to(onlineUsers[vendor._id].socketId).emit("notification", {
            title: vendorNotification.title,
            message: vendorNotification.message,
            type: vendorNotification.type,
        });
    }

    // --- To Admin (the one who deleted) ---
    const adminId = req.user._id.toString();
    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", {
            title: adminNotification.title,
            message: adminNotification.message,
            type: adminNotification.type,
        });
    }

    // 7️⃣ Send Mobile Push Notification (Expo)
    if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
        try {
            await expo.sendPushNotificationsAsync([
                {
                    to: vendor.expoPushToken,
                    sound: "default",
                    title: vendorNotification.title,
                    body: vendorNotification.message,
                    data: { type: "account_deleted" },
                },
            ]);
        } catch (error) {
            console.error("Expo Push Error:", error);
        }
    }

    // 8️⃣ Final Response
    res.status(200).json({
        success: true,
        message:
            "Vendor account deleted and notifications sent to vendor and admin.",
    });
});


const getBuyerDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1. Find buyer
    const buyer = await User.findById(id).select(
        "name address mobileNumber profilePicture role"
    );

    if (!buyer || buyer.role !== "Buyer") {
        return res
            .status(404)
            .json({ success: false, message: "Buyer not found." });
    }

    // 2. Count orders
    const totalOrders = await Order.countDocuments({ buyer: id });

    // 3. Fetch buyer's orders with populated products and vendor
    const orders = await Order.find({ buyer: id })
        .populate({
            path: "products.product", // product details
            select:
                "name variety unit rating quantity weightPerPiece category price images",
        })
        .populate({
            path: "vendor", // ✅ populate vendor info
            select: "name ",
        })
        .sort({ createdAt: -1 });

    // 4. Response
    res.status(200).json({
        success: true,
        data: {
            buyer: {
                name: buyer.name,
                location: buyer.address,
                contactNo: buyer.mobileNumber,
                profilePicture: buyer.profilePicture,
                totalOrders,
            },
            orders: orders.map((order) => ({
                ...order.toObject(),
                vendorDetails: order.vendor
                    ? {
                        name: order.vendor.name,
                        shopName: order.vendor.shopName,
                        mobileNumber: order.vendor.mobileNumber,
                        profilePicture: order.vendor.profilePicture,
                    }
                    : null,
            })),
        },
    });
});

const getBuyers = asyncHandler(async (req, res) => {
    const buyers = await User.aggregate([
        { $match: { role: "Buyer" } },

        // ✅ Lookup total orders as Buyer
        {
            $lookup: {
                from: "orders",
                let: { buyerId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ["$buyer", "$$buyerId"] } // match all orders placed by this buyer
                        }
                    }
                ],
                as: "orders"
            }
        },
        {
            $addFields: {
                totalOrders: { $size: "$orders" },
                totalOrdersAsBuyer: { $size: "$orders" }
            }
        },

        // ✅ Lookup Addresses for Buyer
        {
            $lookup: {
                from: "addresses",
                localField: "_id",
                foreignField: "user",
                as: "addresses"
            }
        },

        // ✅ Fallback to user's embedded address if no separate address exists
        {
            $addFields: {
                addresses: {
                    $cond: [
                        { $eq: [{ $size: "$addresses" }, 0] },
                        {
                            $cond: [
                                { $ifNull: ["$address", false] },
                                ["$address"], // wrap embedded address in array
                                []
                            ]
                        },
                        "$addresses"
                    ]
                }
            }
        },

        // ✅ Final clean projection
        {
            $project: {
                _id: 1,
                name: 1,
                mobileNumber: 1,
                addresses: 1,
                totalOrders: 1,
                totalOrdersAsBuyer: 1,
                createdAt: 1
            }
        },

        { $sort: { createdAt: -1 } } // recent buyers first
    ]);

    res.status(200).json({
        success: true,
        total: buyers.length,
        data: buyers
    });
});

const blockBuyer = asyncHandler(async (req, res) => {
    const buyer = await User.findById(req.params.id);
    if (buyer) {
        buyer.status = 'Blocked';
        await buyer.save();
        res.json({ message: 'Buyer blocked' });
    } else {
        res.status(404).json({ message: 'Buyer not found' });
    }
});

const deleteBuyer = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1. Find the user
    const user = await User.findById(id);

    if (!user || user.role !== "Buyer") {
        return res.status(404).json({ success: false, message: "Buyer not found." });
    }

    // 2. Remove related data
    await Promise.all([
        Address.deleteMany({ user: id }),
        Order.deleteMany({ buyer: id }),
        Cart.deleteMany({ user: id }),
        Wishlist.deleteMany({ user: id }),
    ]);

    // 3. Remove the user
    await user.deleteOne();

    res.json({
        success: true,
        message: "Buyer and related data removed successfully.",
    });
});

const getOrders = asyncHandler(async (req, res) => {
    const { q } = req.query;

    // 🔍 Search condition for buyer name, vendor name, or orderId
    const searchStage = q
        ? {
            $or: [
                { orderId: { $regex: q, $options: "i" } },
                { "buyerInfo.name": { $regex: q, $options: "i" } },
                { "vendorInfo.name": { $regex: q, $options: "i" } },
            ],
        }
        : {};

    // --- Aggregation pipeline (without pagination) ---
    const pipeline = [
        // 1️⃣ Lookup Buyer Info
        {
            $lookup: {
                from: "users",
                localField: "buyer",
                foreignField: "_id",
                as: "buyerInfo",
            },
        },
        { $unwind: "$buyerInfo" },

        // 2️⃣ Lookup Vendor Info
        {
            $lookup: {
                from: "users",
                localField: "vendor",
                foreignField: "_id",
                as: "vendorInfo",
            },
        },
        { $unwind: "$vendorInfo" },

        // 3️⃣ Apply search if provided
        { $match: searchStage },

        // 4️⃣ Sort newest first
        { $sort: { createdAt: -1 } },

        // 5️⃣ Project fields cleanly
        {
            $project: {
                _id: 1,
                orderId: 1,
                totalPrice: 1,
                createdAt: 1,
                buyer: "$buyerInfo.name",
                vendor: "$vendorInfo.name",
                action: "View",
                status: {
                    $switch: {
                        branches: [
                            { case: { $eq: ["$orderStatus", "In-process"] }, then: "In Process" },
                            { case: { $eq: ["$orderStatus", "Confirmed"] }, then: "In Process" },
                            { case: { $eq: ["$orderStatus", "Completed"] }, then: "Completed" },
                            { case: { $eq: ["$orderStatus", "Cancelled"] }, then: "Cancelled" },
                        ],
                        default: "Unknown",
                    },
                },
            },
        },
    ];

    // Run aggregation
    const orders = await Order.aggregate(pipeline);

    res.status(200).json({
        success: true,
        total: orders.length,
        data: orders,
    });
});

const getOrderDetail = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const order = await Order.findById(id)
        .populate('buyer', 'name')
        .populate({
            path: 'products.product',  // ✅ correct field
            select: 'name variety price unit'
        });

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Format response
    const formattedItems = order.products.map(p => ({
        name: p.product ? `${p.product.name} (${p.product.variety})` : null,
        quantity: p.quantity,
        unit: p.product?.unit || null,
        price: p.price * p.quantity
    }));

    res.status(200).json({
        success: true,
        data: {
            orderId: order.orderId,
            buyer: order.buyer?.name || null,
            items: formattedItems,
            totalPrice: order.totalPrice,
            status: order.orderStatus,
            type: order.orderType
        }
    });
});


const deleteOrder = asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (order) {
        await order.remove();
        res.json({ message: 'Order removed' });
    } else {
        res.status(404).json({ message: 'Order not found' });
    }
});


const getBanners = asyncHandler(async (req, res) => {
    const { placement, status } = req.query;

    // Build query object
    const query = {};
    if (placement) query.placement = placement;
    if (status) query.status = status;

    // Fetch banners
    const banners = await Banner.find(query).sort({ createdAt: -1 }); // newest first
    console.log("banner", banners)
    res.status(200).json({
        success: true,
        count: banners.length,
        banners
    });
});

const getBannersByPlacement = asyncHandler(async (req, res) => {
    const { placement } = req.params;

    if (!placement) {
        return res.status(400).json({ success: false, message: 'Placement is required' });
    }

    const banners = await Banner.find({ placement, status: 'Active' }).sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        count: banners.length,
        data: banners
    });
});


const createBanner = asyncHandler(async (req, res) => {
    // 1️⃣ Check if files are uploaded

    if (!req.files || req.files.length === 0) {
        res.status(400);
        throw new Error('At least one image file is required');
    }

    const { title, link, placement, status } = req.body;

    // Optional: Validate placement and status
    const validPlacements = [
        'HomePageSlider',
        'HomePageBottomPromo',
        'CategoryTop',
        'SearchPageAd',
        'CheckoutPromo'
    ];
    const validStatus = ['Active', 'Inactive'];

    const finalPlacement = validPlacements.includes(placement) ? placement : 'HomePageSlider';
    const finalStatus = validStatus.includes(status) ? status : 'Active';

    // 2️⃣ Map each uploaded file to a banner object
    const bannersData = req.files.map(file => ({
        imageUrl: file.path,      // Cloudinary or local path
        public_id: file.filename || file.public_id || '', // Cloudinary public_id if available
        title: title || 'Promotional Banner',
        link: link || '#',
        placement: finalPlacement,
        status: finalStatus
    }));

    // 3️⃣ Insert multiple banners at once
    const banners = await Banner.insertMany(bannersData);

    // 4️⃣ Respond with created banners
    res.status(201).json({
        success: true,
        message: `${banners.length} banner(s) created successfully`,
        banners
    });
});

const deleteBanner = asyncHandler(async (req, res) => {
    const banner = await Banner.findById(req.params.id);

    if (!banner) {
        return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    // Delete image from Cloudinary if public_id exists
    if (banner.public_id) {
        try {
            await cloudinary.uploader.destroy(banner.public_id);
        } catch (err) {
            console.error('Cloudinary deletion error:', err);
            // Continue even if Cloudinary deletion fails
        }
    }

    // ✅ Delete the banner from database
    await Banner.findByIdAndDelete(req.params.id);

    res.status(200).json({
        success: true,
        message: 'Banner deleted successfully',
        bannerId: req.params.id
    });
});


const getCategories = asyncHandler(async (req, res) => {
    const categories = await Category.find({}).sort({ name: 1 }); // optional: sort alphabetically
    res.json(categories);
});


const createCategory = asyncHandler(async (req, res) => {
    const { name } = req.body;

    // 1️⃣ Validate image
    if (!req.file) {
        res.status(400);
        throw new Error("Please provide an image for the category");
    }

    // 2️⃣ Upload image to Cloudinary
    const result = await cloudinaryUpload(req.file.path, "categories");

    // 3️⃣ Create category in DB
    const category = await Category.create({
        name,
        image: {
            url: result.secure_url,
            public_id: result.public_id,
        },
    });

    // 4️⃣ Notification setup
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const title = "🆕 New Category Added";
    const message = `Category "${name}" has been created successfully.`;

    // 5️⃣ Find all Admin users
    const admins = await User.find({ role: "Admin" }, "_id expoPushToken");

    // 6️⃣ Save notification in DB
    const notifications = admins.map((admin) => ({
        title,
        message,
        type: "success",
        sender: req.user._id,
        receiver: admin._id,
        role: admin.role,
    }));
    await Notification.insertMany(notifications);

    // 7️⃣ Real-time Socket.io notification
    admins.forEach((admin) => {
        const adminId = admin._id.toString();
        if (onlineUsers[adminId]) {
            io.to(onlineUsers[adminId].socketId).emit("notification", {
                title,
                message,
                type: "success",
            });
        }
    });

    // 8️⃣ Optional — Expo push for Admin mobile app
    const pushMessages = [];
    for (const admin of admins) {
        if (admin.expoPushToken && Expo.isExpoPushToken(admin.expoPushToken)) {
            pushMessages.push({
                to: admin.expoPushToken,
                sound: "default",
                title,
                body: message,
                data: { type: "category_create", categoryId: category._id },
            });
        }
    }

    if (pushMessages.length > 0) {
        await expo.sendPushNotificationsAsync(pushMessages);
    }

    // ✅ 9️⃣ Final response
    res.status(201).json({
        success: true,
        message: "Category created and notification sent to admin.",
        data: category,
    });
});


const updateCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({ message: 'Category not found' });
    }

    // Update name
    category.name = req.body.name || category.name;

    // If new image is uploaded
    if (req.file) {
        // Delete old image from Cloudinary if exists
        if (category.image && category.image.public_id) {
            await cloudinaryDestroy(category.image.public_id);
        }

        // Upload new image
        const result = await cloudinaryUpload(req.file.path, 'categories');
        category.image = {
            url: result.secure_url,
            public_id: result.public_id
        };
    }

    const updatedCategory = await category.save();
    res.json(updatedCategory);
});

const deleteCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({ success: false, message: "Category not found." });
    }

    await category.deleteOne(); // <-- Updated here

    res.status(200).json({
        success: true,
        message: "Category deleted successfully.",
    });
});

const getCategoryById = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, category });
});


const createCoupon = asyncHandler(async (req, res) => {
    try {
        const adminId = req.user._id; // Admin creating the coupon
        const {
            code,
            discount, // { value: Number, type: 'Percentage' | 'Fixed' }
            minimumOrder = 0,
            usageLimitPerUser = 1,
            totalUsageLimit = 0,
            startDate,
            expiryDate,
            appliesTo = [],
            applicableProducts = [],
        } = req.body;

        // 1️⃣ Required fields check
        if (!code || !discount?.value || !discount?.type || !startDate || !expiryDate) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields (code, discount, startDate, expiryDate).",
            });
        }

        // 2️⃣ Check duplicate
        const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (existingCoupon) {
            return res.status(400).json({ success: false, message: "Coupon code already exists." });
        }

        // 3️⃣ Validate dates
        if (new Date(expiryDate) <= new Date(startDate)) {
            return res.status(400).json({
                success: false,
                message: "Expiry date must be after start date.",
            });
        }

        // 4️⃣ Create coupon
        const newCoupon = await Coupon.create({
            code: code.toUpperCase(),
            discount,
            minimumOrder,
            usageLimitPerUser,
            totalUsageLimit,
            startDate,
            expiryDate,
            appliesTo: appliesTo.length > 0 ? appliesTo : ["All Products"],
            applicableProducts,
            vendor: null, // Global coupon
            createdBy: adminId,
        });

        // 5️⃣ Get socket + online users
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers");

        // 6️⃣ Notification details
        const title = "🎉 New Coupon Available!";
        const message = `A new coupon "${newCoupon.code}" has been released. Enjoy discounts on your orders!`;

        // 7️⃣ Fetch all users (buyers + vendors + admins)
        const allUsers = await User.find(
            { role: { $in: ["Buyer", "Vendor", "Admin"] } },
            "_id role expoPushToken"
        );

        // Prepare notifications for DB
        const notifications = allUsers.map((user) => ({
            title,
            message,
            type: "info",
            sender: adminId,
            receiver: user._id,
            role: user.role,
        }));

        await Notification.insertMany(notifications);

        // 8️⃣ Send real-time socket notifications
        allUsers.forEach((user) => {
            const userId = user._id.toString();
            if (onlineUsers[userId]) {
                io.to(onlineUsers[userId].socketId).emit("notification", {
                    title,
                    message,
                    type: "info",
                });
            }
        });

        // 9️⃣ Send Expo push notifications (for app users)
        const pushMessages = [];
        for (const user of allUsers) {
            if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
                pushMessages.push({
                    to: user.expoPushToken,
                    sound: "default",
                    title,
                    body: message,
                    data: { type: "new_coupon", couponCode: newCoupon.code },
                });
            }
        }

        if (pushMessages.length > 0) {
            await expo.sendPushNotificationsAsync(pushMessages);
        }

        // 🔟 Final Response
        res.status(201).json({
            success: true,
            message: "Coupon created and notifications sent to all users.",
            data: newCoupon,
        });
    } catch (error) {
        console.error("❌ Error creating coupon:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create coupon.",
            error: error.message,
        });
    }
});

const getAdminCoupons = asyncHandler(async (req, res) => {
    const { q, status } = req.query;
    const user = req.user || {};

    const query = {};

    // 🔍 Optional filters
    if (q) query.code = { $regex: q, $options: 'i' };
    if (status) query.status = status;

    // 🔒 Restrict vendors to their own coupons
    if (user.role === 'vendor') {
        query.createdBy = user._id;
    }

    // 🧾 Fetch all coupons without pagination
    const coupons = await Coupon.find(query)
        .populate('createdBy', 'name email role')
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        count: coupons.length,
        data: coupons,
    });
});

const updateCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = { ...req.body };

    // 1️⃣ Validate Coupon ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid coupon ID.",
        });
    }

    // 2️⃣ Protect sensitive fields
    const protectedFields = ["usedCount", "usedBy", "createdBy", "vendor"];
    protectedFields.forEach((field) => delete updates[field]);

    // 3️⃣ Auto uppercase coupon code
    if (updates.code) {
        updates.code = updates.code.toUpperCase();
    }

    // 4️⃣ Validate appliesTo categories
    if (updates.appliesTo) {
        const validCategories = [
            "All Products",
            "Fruits",
            "Vegetables",
            "Plants",
            "Seeds",
            "Handicrafts",
        ];
        const invalid = updates.appliesTo.filter(
            (cat) => !validCategories.includes(cat)
        );
        if (invalid.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Invalid category in appliesTo: ${invalid.join(", ")}`,
            });
        }
    }

    // 5️⃣ Validate date range
    if (updates.startDate && updates.expiryDate) {
        if (new Date(updates.expiryDate) <= new Date(updates.startDate)) {
            return res.status(400).json({
                success: false,
                message: "Expiry date must be after start date.",
            });
        }
    }

    // 6️⃣ Update the coupon in DB
    const coupon = await Coupon.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
    });

    if (!coupon) {
        return res
            .status(404)
            .json({ success: false, message: "Coupon not found." });
    }

    // 7️⃣ Notification setup
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const title = "🎟️ Coupon Updated";
    const message = `Coupon "${coupon.code}" has been updated. Check the latest details!`;

    // 8️⃣ Fetch only Admins and Buyers
    const allUsers = await User.find(
        { role: { $in: ["Admin", "Buyer"] } },
        "_id role expoPushToken"
    );

    // 9️⃣ Save notifications to DB
    const notifications = allUsers.map((user) => ({
        title,
        message,
        type: "info",
        sender: req.user._id,
        receiver: user._id,
        role: user.role,
    }));
    await Notification.insertMany(notifications);

    // 🔟 Send real-time notifications via Socket.io
    allUsers.forEach((user) => {
        const userId = user._id.toString();
        if (onlineUsers[userId]) {
            io.to(onlineUsers[userId].socketId).emit("notification", {
                title,
                message,
                type: "info",
            });
        }
    });

    // 1️⃣1️⃣ Push notification for mobile (Buyers in Expo)
    const pushMessages = [];
    for (const user of allUsers) {
        if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
            pushMessages.push({
                to: user.expoPushToken,
                sound: "default",
                title,
                body: message,
                data: { type: "coupon_update", couponId: coupon._id },
            });
        }
    }

    // Send push notifications (if any)
    if (pushMessages.length > 0) {
        await expo.sendPushNotificationsAsync(pushMessages);
    }

    // ✅ Final response
    res.status(200).json({
        success: true,
        message: "Coupon updated and notifications sent to Admin and Buyers.",
        data: coupon,
    });
});


const deleteCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Find the coupon
    const coupon = await Coupon.findById(id).populate("vendor", "name _id expoPushToken");
    if (!coupon) {
        return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    // 2️⃣ Delete the coupon
    await coupon.deleteOne();

    // 3️⃣ Socket & online users setup
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // 4️⃣ Notify vendor (if coupon belongs to one)
    if (coupon.vendor) {
        const vendorId = coupon.vendor._id.toString();
        const vendorTitle = "Coupon Deleted ⚠️";
        const vendorMessage = `The coupon "${coupon.code}" associated with your store has been deleted by the admin.`;

        // Save DB notification
        await Notification.create({
            title: vendorTitle,
            message: vendorMessage,
            type: "warning",
            sender: req.user._id,
            receiver: vendorId,
            role: "Vendor",
            relatedCoupon: coupon._id,
        });

        // Real-time socket
        if (onlineUsers[vendorId]) {
            io.to(onlineUsers[vendorId].socketId).emit("notification", {
                title: vendorTitle,
                message: vendorMessage,
                type: "warning",
            });
        }

        // Push notification via Expo
        if (coupon.vendor.expoPushToken && Expo.isExpoPushToken(coupon.vendor.expoPushToken)) {
            await expo.sendPushNotificationsAsync([
                {
                    to: coupon.vendor.expoPushToken,
                    sound: "default",
                    title: vendorTitle,
                    body: vendorMessage,
                    data: { type: "coupon_deleted", couponId: coupon._id },
                },
            ]);
        }
    }

    // 5️⃣ Notify admin (confirmation)
    const adminId = req.user._id.toString();
    const adminTitle = "Coupon Deleted ✅";
    const adminMessage = `You successfully deleted the coupon "${coupon.code}".`;

    await Notification.create({
        title: adminTitle,
        message: adminMessage,
        type: "success",
        sender: adminId,
        receiver: adminId,
        role: "Admin",
        relatedCoupon: coupon._id,
    });

    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", {
            title: adminTitle,
            message: adminMessage,
            type: "success",
        });
    }

    // 6️⃣ Final response
    res.status(200).json({
        success: true,
        message: "Coupon deleted successfully and notifications sent.",
    });
});

const getAdminProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('name email upiId profilePicture');

    if (!user) {
        return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    res.status(200).json({
        success: true,
        data: {
            name: user.name,
            email: user.email,
            upiId: user.upiId || null,

            profilePicture: user.profilePicture || null,
        },
    });
});

const updateAdminProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    // Extract fields
    const { name, email, upiId } = req.body;

    // --- Update Name ---
    if (name) user.name = name;

    // --- Update Email with duplicate check ---
    if (email) {
        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser._id.toString() !== req.user.id) {
            return res.status(400).json({ success: false, message: 'Email already exists.' });
        }
        user.email = email;
    }

    // --- Update UPI ID ---
    if (upiId) {
        // Basic validation for UPI format (e.g., example@upi)
        const upiPattern = /^[\w.\-_]{2,}@[a-zA-Z]{2,}$/;
        if (!upiPattern.test(upiId)) {
            return res.status(400).json({ success: false, message: 'Invalid UPI ID format.' });
        }
        user.upiId = upiId;
    }

    // --- Update Profile Picture ---
    if (req.file) {
        try {
            if (user.profilePicture) {
                const oldPublicId = user.profilePicture.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`admin-profiles/${oldPublicId}`);
            }

            const result = await cloudinary.uploader.upload(req.file.path, { folder: 'admin-profiles' });
            user.profilePicture = result.secure_url;
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Profile picture upload failed.' });
        }
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        data: {
            name: user.name,
            email: user.email,
            upiId: user.upiId || null,
            profilePicture: user.profilePicture || null,
        },
    });
});


const changeAdminPassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: 'All password fields are required.' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'New password and confirm password do not match.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Incorrect current password.' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
        success: true,
        message: 'Password changed successfully.',
    });
});


const deleteAdminProfilePicture = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (!user || !user.profilePicture) {
        return res.status(404).json({ success: false, message: 'Admin or profile picture not found.' });
    }

    try {
        const publicId = user.profilePicture.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`admin-profiles/${publicId}`);
    } catch (error) {
        console.error('Cloudinary deletion failed:', error);
    }

    user.profilePicture = '';
    await user.save();

    res.status(200).json({
        success: true,
        message: 'Profile picture deleted successfully.',
        data: { profilePicture: null },
    });
});

const getNotificationSettings = asyncHandler(async (req, res) => {
    // Logic to fetch notification settings from a separate settings model or the admin user document
    res.json({
        newVendorRegistration: true,
        newBuyerRegistration: true,
        newProductRegistration: true,
        newOrderPlaced: true
    });
});
const updateNotificationSettings = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    const { newVendorRegistration, newBuyerRegistration, newProductRegistration, newOrderPlaced } = req.body;

    // Update only the provided fields
    if (newVendorRegistration !== undefined) user.notificationSettings.newVendorRegistration = newVendorRegistration;
    if (newBuyerRegistration !== undefined) user.notificationSettings.newBuyerRegistration = newBuyerRegistration;
    if (newProductRegistration !== undefined) user.notificationSettings.newProductRegistration = newProductRegistration;
    if (newOrderPlaced !== undefined) user.notificationSettings.newOrderPlaced = newOrderPlaced;

    await user.save();

    res.status(200).json({
        success: true,
        message: 'Notification settings updated successfully.',
        notificationSettings: user.notificationSettings
    });
});

const getCustomerSupportDetails = asyncHandler(async (req, res) => {
    // Find the single settings document, creating it if it doesn't exist (upsert)
    const settings = await CustomerSupport.findOneAndUpdate(
        { appId: 'customer_support_settings' },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: settings });
});

const updateCustomerSupportDetails = asyncHandler(async (req, res) => {
    const updates = req.body;

    const settings = await CustomerSupport.findOneAndUpdate(
        { appId: 'customer_support_settings' },
        { $set: updates },
        { new: true, runValidators: true }
    );

    if (!settings) {
        // Should not happen due to upsert in GET, but safety check added
        return res.status(404).json({ success: false, message: 'Settings document not found.' });
    }

    res.status(200).json({
        success: true,
        message: 'Customer support details updated.',
        data: settings
    });
});



const getStaticPageContent = asyncHandler(async (req, res) => {
    const { pageName } = req.params;

    const page = await StaticPage.findOne({ pageName: pageName.toLowerCase() });

    if (!page) {
        // Return a 404 error if the page has not been created yet
        return res.status(404).json({
            success: false,
            message: 'Page not found.'
        });
    }

    res.status(200).json({
        success: true,
        data: {
            pageName: page.pageName,
            content: page.content
        }
    });
});


const updateStaticPageContent = asyncHandler(async (req, res) => {
    const { pageName } = req.params;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ success: false, message: 'Content field is required.' });
    }

    // Find and update the page content, creating it if it doesn't exist (upsert)
    const page = await StaticPage.findOneAndUpdate(
        { pageName: pageName.toLowerCase() },
        { content: content },
        { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
        success: true,
        message: `${pageName} content updated successfully.`,
        data: page
    });
});


const updatePageContent = asyncHandler(async (req, res) => {
    const { content } = req.body;
    try {
        const page = await StaticPage.findOneAndUpdate(
            { pageName: req.params.pageName },
            { content, lastUpdatedBy: req.user._id },
            { new: true, upsert: true } // upsert creates the document if it doesn't exist
        );

        res.status(200).json({
            success: true,
            message: `${req.params.pageName} updated successfully.`,
            page
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.', error: error.message });
    }
});


const postPageContent = asyncHandler(async (req, res) => {
    const { pageName, content } = req.body;
    try {
        const existingPage = await StaticPage.findOne({ pageName });
        if (existingPage) {
            return res.status(400).json({ success: false, message: 'A page with this name already exists. Use PUT to update.' });
        }

        const newPage = new StaticPage({
            pageName,
            content,
            lastUpdatedBy: req.user._id
        });

        const createdPage = await newPage.save();

        res.status(201).json({
            success: true,
            message: `${pageName} created successfully.`,
            page: createdPage
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.', error: error.message });
    }
});


const reportIssue = asyncHandler(async (req, res) => {
    const { title, issueDescription } = req.body;
    const reportedBy = req.user._id;

    if (!title || !issueDescription) {
        return res.status(400).json({ success: false, message: 'Title and issue description are required.' });
    }

    try {
        // Upload photos to Cloudinary if they exist
        const photos = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const result = await cloudinary.uploader.upload(file.path);
                photos.push(result.secure_url);
            }
        }

        const newIssue = new Issue({
            title,
            issueDescription,
            photos,
            reportedBy,
        });

        const createdIssue = await newIssue.save();

        res.status(201).json({
            success: true,
            message: 'Issue reported successfully.',
            issue: createdIssue
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.', error: error.message });
    }
});


const getuserNotificationSettings = asyncHandler(async (req, res) => {
    // Find the single settings document. Create it with defaults if it doesn't exist.
    const settings = await NotificationSettings.findOneAndUpdate(
        { appId: 'app_settings' },
        {}, // No update needed, just find
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
        success: true,
        data: settings
    });
});


const updateuserNotificationSettings = asyncHandler(async (req, res) => {
    // The request body should contain the full set of current settings from the frontend
    const updates = req.body;

    const settings = await NotificationSettings.findOneAndUpdate(
        { appId: 'app_settings' },
        { $set: updates },
        { new: true, runValidators: true }
    );

    if (!settings) {
        return res.status(404).json({ success: false, message: 'Notification settings not found.' });
    }

    res.status(200).json({
        success: true,
        message: 'Notification settings updated successfully.',
        data: settings
    });
});


const approveVendor = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1️⃣ Find vendor
    const vendor = await User.findOne({ _id: id, role: "Vendor" });
    if (!vendor) {
        return res.status(404).json({
            success: false,
            message: "Vendor not found.",
        });
    }

    // 2️⃣ Update vendor status
    vendor.status = "Active";
    vendor.isApproved = true;
    await vendor.save();

    // 3️⃣ Activate vendor's products if inactive
    await Product.updateMany({ vendor: id, status: "Inactive" }, { status: "In Stock" });

    // 4️⃣ Socket and online users
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // 🟡 Vendor Notification
    const vendorTitle = "Account Approved 🎉";
    const vendorMessage =
        "Congratulations! Your vendor account has been approved by the admin. You can now start selling your products.";

    await Notification.create({
        title: vendorTitle,
        message: vendorMessage,
        type: "success",
        sender: req.user._id,
        receiver: vendor._id,
        role: "Vendor",
    });

    // Real-time socket for vendor
    if (onlineUsers[vendor._id]) {
        io.to(onlineUsers[vendor._id].socketId).emit("notification", {
            title: vendorTitle,
            message: vendorMessage,
            type: "success",
        });
    }

    // Push notification via Expo
    if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
        await expo.sendPushNotificationsAsync([
            {
                to: vendor.expoPushToken,
                sound: "default",
                title: vendorTitle,
                body: vendorMessage,
                data: { type: "vendor_approval", vendorId: vendor._id },
            },
        ]);
    }

    // 🟢 Admin Notification (self confirmation)
    const adminId = req.user._id.toString();
    const adminTitle = "Vendor Approved ✅";
    const adminMessage = `You successfully approved vendor "${vendor.name}".`;

    await Notification.create({
        title: adminTitle,
        message: adminMessage,
        type: "info",
        sender: adminId,
        receiver: adminId,
        role: "Admin",
    });

    // Real-time socket for admin
    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", {
            title: adminTitle,
            message: adminMessage,
            type: "info",
        });
    }

    // ✅ 5️⃣ Final response
    res.status(200).json({
        success: true,
        message: "Vendor approved and notifications sent successfully.",
        data: {
            vendorId: vendor._id,
            name: vendor.name,
            email: vendor.email,
            status: vendor.status,
            isApproved: vendor.isApproved,
        },
    });
});


const rejectVendor = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // 1️⃣ Validate reason
    if (!rejectionReason || rejectionReason.trim().length < 5) {
        return res.status(400).json({
            success: false,
            message: "Rejection reason must be at least 5 characters long.",
        });
    }

    // 2️⃣ Find vendor
    const vendor = await User.findOne({ _id: id, role: "Vendor" });
    if (!vendor) {
        return res.status(404).json({
            success: false,
            message: "Vendor not found.",
        });
    }

    // 3️⃣ Update vendor details
    vendor.status = "Rejected";
    vendor.isApproved = false;
    vendor.rejectionReason = rejectionReason;
    await vendor.save();

    // 4️⃣ Deactivate all their products
    await Product.updateMany({ vendor: id }, { status: "Out of Stock" });

    // 5️⃣ Setup notification context
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // --- Vendor Notification ---
    const vendorTitle = "Account Rejected ❌";
    const vendorMessage = `Your vendor registration was rejected. Reason: ${rejectionReason}`;

    await Notification.create({
        title: vendorTitle,
        message: vendorMessage,
        type: "error",
        sender: req.user._id,
        receiver: vendor._id,
        role: "Vendor",
    });

    // Real-time socket (if vendor online)
    if (onlineUsers[vendor._id]) {
        io.to(onlineUsers[vendor._id].socketId).emit("notification", {
            title: vendorTitle,
            message: vendorMessage,
            type: "error",
        });
    }

    // Push notification via Expo (if vendor on mobile)
    if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
        await expo.sendPushNotificationsAsync([
            {
                to: vendor.expoPushToken,
                sound: "default",
                title: vendorTitle,
                body: vendorMessage,
                data: { type: "vendor_rejection", vendorId: vendor._id },
            },
        ]);
    }

    // --- Admin Confirmation Notification ---
    const adminId = req.user._id.toString();
    const adminTitle = "Vendor Rejected ✅";
    const adminMessage = `You rejected vendor "${vendor.name}" for reason: "${rejectionReason}".`;

    await Notification.create({
        title: adminTitle,
        message: adminMessage,
        type: "success",
        sender: adminId,
        receiver: adminId,
        role: "Admin",
    });

    // Real-time socket (if admin online)
    if (onlineUsers[adminId]) {
        io.to(onlineUsers[adminId].socketId).emit("notification", {
            title: adminTitle,
            message: adminMessage,
            type: "success",
        });
    }

    // ✅ 6️⃣ Send final response
    res.status(200).json({
        success: true,
        message: "Vendor rejected and notifications sent successfully.",
        data: {
            vendorId: vendor._id,
            name: vendor.name,
            email: vendor.email,
            status: vendor.status,
            isApproved: vendor.isApproved,
            rejectionReason: vendor.rejectionReason,
        },
    });
});

module.exports = {
    getDashboardStats,
    getProducts, approveVendor,
    getAdminProductDetails,
    addOrUpdateNutritionalValue,
    deleteProduct,
    getVendors,
    getVendorDetails,
    updateVendorStatus, rejectVendor,
    deleteVendor,
    getBuyers,
    getBuyerDetails,
    blockBuyer,
    deleteBuyer,
    getOrders,
    getOrderDetail,
    deleteOrder,
    getBanners,
    createBanner,
    deleteBanner,
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
    getAdminCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    getAdminProfile,
    updateAdminProfile,
    deleteAdminProfilePicture,
    changeAdminPassword,
    getNotificationSettings,
    updateNotificationSettings,
    getStaticPageContent,
    updatePageContent,
    postPageContent,
    reportIssue,
    getRecentActivity,
    getuserNotificationSettings, getBannersByPlacement,
    updateuserNotificationSettings, getCustomerSupportDetails, updateCustomerSupportDetails, updateStaticPageContent
};
