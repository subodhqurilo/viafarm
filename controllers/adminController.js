const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Category = require('../models/Category');
const Cart = require("../models/Cart");
const Wishlist = require("../models/Wishlist");
const Variety = require('../models/Variety');
const NotificationSettings = require('../models/NotificationSettings');
const CustomerSupport = require('../models/CustomerSupport');
const StaticPage = require('../models/StaticPage');
const { createAndSendNotification } = require('../utils/notificationUtils');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');
const axios = require('axios');
const { cloudinaryUpload, cloudinaryDestroy,upload } = require("../services/cloudinaryService");

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

    // 🏷 Filter by category NAME
    if (category) {
        const cat = await Category.findOne({
            name: { $regex: category, $options: "i" }
        });

        if (cat) {
            query.category = cat._id;
        }
    }

    // 📦 Fetch all matching products
    const products = await Product.find(query)
        .populate("vendor", "name")              // vendor remains same structure
        .populate("category", "name")            // populate category NAME
        .select("name category price unit createdAt vendor")
        .sort({ createdAt: -1 });

    // 🎯 Final Format: SAME structure, ONLY category = name
    const finalData = products.map((item) => ({
        _id: item._id,
        name: item.name,
        vendor: item.vendor,                    // SAME as before
        category: item.category?.name || null,  // ONLY NAME
        price: item.price,
        unit: item.unit,
        createdAt: item.createdAt,
    }));

    res.status(200).json({
        success: true,
        total: finalData.length,
        data: finalData,
    });
});



const getAdminProductDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid product ID."
        });
    }

    const product = await Product.findById(id)
        .populate("vendor", "name profilePicture address")
        .populate("category", "name");   // ✅ category name only

    if (!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found."
        });
    }

    // 🎯 Convert category object → only name
    const formattedProduct = {
        ...product.toObject(),
        category: product.category?.name || null  // ✅ only name
    };

    res.status(200).json({
        success: true,
        data: {
            product: formattedProduct
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

  // 2️⃣ Socket references
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};

  // 3️⃣ Build Notification Templates
  const vendorNotification = {
    title: "Product Updated by Admin 🧾",
    message: `Admin updated nutritional info for your product "${product.name}".`,
    receiverId: product.vendor._id,
    userType: "Vendor",
    data: { productId: product._id },
    createdBy: req.user._id,
  };

  const adminNotification = {
    title: "Update Successful ✅",
    message: `You updated nutritional info for "${product.name}".`,
    receiverId: req.user._id,
    userType: "Admin",
    data: { productId: product._id },
    createdBy: req.user._id,
  };

  // 4️⃣ Save notifications in DB
  const savedNotifications = await Notification.insertMany([
    vendorNotification,
    adminNotification,
  ]);

  const vendorNotifPayload = savedNotifications[0];
  const adminNotifPayload = savedNotifications[1];

  // 5️⃣ Real-time Socket.IO
  const vendorId = product.vendor._id.toString();
  const adminId = req.user._id.toString();

  // Vendor real-time
  if (onlineUsers[vendorId]) {
    io.to(onlineUsers[vendorId].socketId).emit("notification", vendorNotifPayload);
  }

  // Admin real-time
  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", adminNotifPayload);
  }

  // 6️⃣ Expo Push Notification to Vendor (Mobile)
  if (product.vendor.expoPushToken && Expo.isExpoPushToken(product.vendor.expoPushToken)) {
    try {
      const messages = [
        {
          to: product.vendor.expoPushToken,
          sound: "default",
          title: vendorNotification.title,
          body: vendorNotification.message,
          data: { productId: product._id },
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Expo push send error:", error);
    }
  }

  // 7️⃣ Final Response
  res.status(200).json({
    success: true,
    message: "Nutritional value updated and notifications sent.",
    data: product.nutritionalValue,
  });
});



const deleteProduct = asyncHandler(async (req, res) => {
  const productId = req.params.id;

  // 1️⃣ Fetch product before deleting
  const product = await Product.findById(productId).populate(
    "vendor",
    "_id name expoPushToken"
  );

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  // 2️⃣ Delete product images from Cloudinary
  if (product.images && product.images.length > 0) {
    for (const img of product.images) {
      if (img.public_id) {
        await cloudinaryDestroy(img.public_id); // 🔥 USE YOUR SERVICE
      }
    }
  }

  // 3️⃣ Delete product document
  await product.deleteOne();

  // 4️⃣ Get socket and online users
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ==========================
  // 🟣 Vendor Notification
  // ==========================
  const vendorId = product.vendor._id.toString();

  const vendorNotificationData = {
    title: "Product Deleted 🗑️",
    message: `Your product "${product.name}" has been deleted by Admin.`,
    receiverId: vendorId,
    userType: "Vendor",
    data: { productId: product._id },
    createdBy: req.user._id,
    isRead: false,
  };

  const vendorNotif = await Notification.create(vendorNotificationData);

  if (onlineUsers[vendorId]) {
    io.to(onlineUsers[vendorId].socketId).emit("notification", vendorNotif);
  }

  if (
    product.vendor.expoPushToken &&
    Expo.isExpoPushToken(product.vendor.expoPushToken)
  ) {
    try {
      const messages = [
        {
          to: product.vendor.expoPushToken,
          sound: "default",
          title: vendorNotificationData.title,
          body: vendorNotificationData.message,
          data: vendorNotificationData.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Expo push error:", error);
    }
  }

  // ==========================
  // 🔵 Admin Notification
  // ==========================
  const adminId = req.user._id.toString();

  const adminNotificationData = {
    title: "Product Removed Successfully ✅",
    message: `You deleted the product "${product.name}".`,
    receiverId: adminId,
    userType: "Admin",
    data: { productId: product._id },
    createdBy: adminId,
    isRead: false,
  };

  const adminNotif = await Notification.create(adminNotificationData);

  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", adminNotif);
  }

  // ==========================
  // ✔ Final Response
  // ==========================
  res.status(200).json({
    success: true,
    message: "Product deleted successfully along with Cloudinary images. Notifications sent.",
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
  const { status } = req.body;

  const validStatuses = ["Active", "Blocked", "UnBlocked", "Inactive"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status provided.",
    });
  }

  // 1️⃣ Update vendor's status
  const vendor = await User.findOneAndUpdate(
    { _id: id, role: "Vendor" },
    { status },
    { new: true, runValidators: true }
  ).select("_id name expoPushToken");

  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: "Vendor not found.",
    });
  }

  // 2️⃣ Update vendor's products
  if (status === "Blocked" || status === "Inactive") {
    await Product.updateMany({ vendor: id }, { status: "Inactive" });
  } else if (status === "Active") {
    await Product.updateMany(
      { vendor: id, status: "Inactive" },
      { status: "In Stock" }
    );
  }

  // 3️⃣ Socket + Expo setup
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ===============================
  // 🟣 Vendor Personal Notification
  // ===============================
  let vendorMessage = "";

  if (status === "Blocked")
    vendorMessage = "Your account has been blocked by the admin.";
  else if (status === "UnBlocked")
    vendorMessage = "Your account has been unblocked.";
  else if (status === "Inactive")
    vendorMessage = "Your account has been set to inactive.";
  else if (status === "Active")
    vendorMessage = "Your account has been activated.";

  const vendorNotification = {
    title: "Account Status Update ⚙️",
    message: vendorMessage,
    receiverId: vendor._id,
    userType: "Vendor",
    data: { status },
    createdBy: req.user._id,
    isRead: false,
  };

  // Save in DB
  const savedVendorNotif = await Notification.create(vendorNotification);

  // Socket message
  if (onlineUsers[vendor._id]) {
    io.to(onlineUsers[vendor._id].socketId).emit(
      "notification",
      savedVendorNotif
    );
  }

  // Expo push
  if (
    vendor.expoPushToken &&
    Expo.isExpoPushToken(vendor.expoPushToken)
  ) {
    try {
      const messages = [
        {
          to: vendor.expoPushToken,
          sound: "default",
          title: vendorNotification.title,
          body: vendorNotification.message,
          data: { status },
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Expo Push Error:", error);
    }
  }

  // 4️⃣ Final response
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
    return res.status(404).json({
      success: false,
      message: "Vendor not found.",
    });
  }

  // 2️⃣ Fetch all vendor products
  const products = await Product.find({ vendor: id });

  // 3️⃣ Delete Cloudinary images of all products
  for (const p of products) {
    if (p.images && p.images.length > 0) {
      for (const img of p.images) {
        if (img.public_id) {
          await cloudinaryDestroy(img.public_id);   // 🔥 Your service usage
        }
      }
    }
  }

  // 4️⃣ Delete all vendor products permanently
  await Product.deleteMany({ vendor: id });

  // 5️⃣ Get socket + expo
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ============================
  // 🟣 Vendor Notification
  // ============================
  const vendorNotificationData = {
    title: "Account Deleted 🛑",
    message:
      "Your vendor account has been deleted by the admin. All your products are removed.",
    receiverId: vendor._id,
    userType: "Vendor",
    createdBy: req.user._id,
    data: { type: "account_deleted" },
    isRead: false,
  };

  const vendorNotif = await Notification.create(vendorNotificationData);

  if (onlineUsers[vendor._id]) {
    io.to(onlineUsers[vendor._id].socketId).emit("notification", vendorNotif);
  }

  if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
    try {
      const messages = [
        {
          to: vendor.expoPushToken,
          sound: "default",
          title: vendorNotificationData.title,
          body: vendorNotificationData.message,
          data: vendorNotificationData.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Expo Push Error:", error);
    }
  }

  // ============================
  // 🔵 Admin Notification
  // ============================
  const adminId = req.user._id.toString();

  const adminNotificationData = {
    title: "Vendor Deleted Successfully ✅",
    message: `You deleted vendor "${vendor.name}".`,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: { vendorId: vendor._id },
    isRead: false,
  };

  const adminNotif = await Notification.create(adminNotificationData);

  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", adminNotif);
  }

  // ============================
  // ✔ Final Response
  // ============================
  res.status(200).json({
    success: true,
    message: "Vendor deleted, products removed, Cloudinary cleaned, notifications sent.",
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

  // 1️⃣ Find buyer
  const buyer = await User.findById(id).select("_id name expoPushToken role profilePicture");

  if (!buyer || buyer.role !== "Buyer") {
    return res.status(404).json({
      success: false,
      message: "Buyer not found.",
    });
  }

  // 2️⃣ Delete buyer profile picture from Cloudinary
  if (buyer.profilePicture) {
    const publicId = buyer.profilePicture.split("/").pop().split(".")[0];
    await cloudinaryDestroy(publicId);
  }

  // 3️⃣ Delete related buyer data
  await Promise.all([
    Address.deleteMany({ user: id }),
    Order.deleteMany({ buyer: id }),
    Cart.deleteMany({ user: id }),
    Wishlist.deleteMany({ user: id }),
  ]);

  // 4️⃣ Delete buyer account
  await buyer.deleteOne();

  // 5️⃣ Notify system (socket + expo)
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ================================
  // 🟣 PERSONAL BUYER NOTIFICATION
  // ================================
  const buyerNotificationData = {
    title: "Account Deleted ❌",
    message: "Your buyer account has been deleted by the admin.",
    receiverId: buyer._id,
    userType: "Buyer",
    createdBy: req.user._id,
    data: { deleted: true },
    isRead: false,
  };

  const savedNotif = await Notification.create(buyerNotificationData);

  // Real-time socket
  if (onlineUsers[buyer._id]) {
    io.to(onlineUsers[buyer._id].socketId).emit("notification", savedNotif);
  }

  // Expo push
  if (buyer.expoPushToken && Expo.isExpoPushToken(buyer.expoPushToken)) {
    try {
      const messages = [
        {
          to: buyer.expoPushToken,
          sound: "default",
          title: buyerNotificationData.title,
          body: buyerNotificationData.message,
          data: buyerNotificationData.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Expo Push Error:", error);
    }
  }

  // ================================
  // 🔵 OPTIONAL: Admin self-notification
  // ================================
  const adminId = req.user._id.toString();

  await Notification.create({
    title: "Buyer Deleted Successfully",
    message: `You deleted buyer "${buyer.name}".`,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: { buyerId: buyer._id },
    isRead: false,
  });

  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", savedNotif);
  }

  // ================================
  // ✔ Final Response
  // ================================
  res.status(200).json({
    success: true,
    message: "Buyer deleted, Cloudinary cleaned, data removed, notification sent.",
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
  const { id } = req.params;

  // 1️⃣ Find order
  const order = await Order.findById(id)
    .populate("buyer", "name expoPushToken _id")
    .populate("vendor", "name expoPushToken _id");

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  // 2️⃣ Delete Cloudinary images (if order items contain images)
  if (order.products && order.products.length > 0) {
    for (const item of order.products) {
      if (item.image && item.image.public_id) {
        await cloudinaryDestroy(item.image.public_id);
      }
    }
  }

  // 3️⃣ Delete order from DB
  await order.deleteOne();

  // 4️⃣ Notifications (Socket + Expo)
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ==========================
  // 🔵 Notify Buyer
  // ==========================
  const buyerNotification = {
    title: "Order Deleted ❌",
    message: `Your order ${order.orderId} has been removed by admin.`,
    receiverId: order.buyer._id,
    userType: "Buyer",
    createdBy: req.user._id,
    data: { orderId: order.orderId },
    isRead: false,
  };

  const savedBuyerNotif = await Notification.create(buyerNotification);

  // Socket to buyer
  if (onlineUsers[order.buyer._id]) {
    io.to(onlineUsers[order.buyer._id].socketId).emit("notification", savedBuyerNotif);
  }

  // Expo push to buyer
  if (
    order.buyer.expoPushToken &&
    Expo.isExpoPushToken(order.buyer.expoPushToken)
  ) {
    try {
      const messages = [
        {
          to: order.buyer.expoPushToken,
          sound: "default",
          title: buyerNotification.title,
          body: buyerNotification.message,
          data: buyerNotification.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // ==========================
  // 🟣 Notify Vendor
  // ==========================
  if (order.vendor) {
    const vendorNotification = {
      title: "Order Removed ❌",
      message: `Order ${order.orderId} for your product was deleted by admin.`,
      receiverId: order.vendor._id,
      userType: "Vendor",
      createdBy: req.user._id,
      data: { orderId: order.orderId },
      isRead: false,
    };

    const savedVendorNotif = await Notification.create(vendorNotification);

    if (onlineUsers[order.vendor._id]) {
      io.to(onlineUsers[order.vendor._id].socketId).emit("notification", savedVendorNotif);
    }

    if (
      order.vendor.expoPushToken &&
      Expo.isExpoPushToken(order.vendor.expoPushToken)
    ) {
      try {
        const messages = [
          {
            to: order.vendor.expoPushToken,
            sound: "default",
            title: vendorNotification.title,
            body: vendorNotification.message,
            data: vendorNotification.data,
          },
        ];

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }
      } catch (err) {
        console.error("Expo Push Error:", err);
      }
    }
  }

  // ==========================
  // 🟤 Admin self-notification
  // ==========================
  const adminId = req.user._id.toString();

  const adminNotif = await Notification.create({
    title: "Order Deleted Successfully",
    message: `You deleted order ${order.orderId}.`,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: { orderId: order.orderId },
    isRead: false,
  });

  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", adminNotif);
  }

  // ==========================
  // ✔ Final Response
  // ==========================
  res.status(200).json({
    success: true,
    message: "Order deleted, Cloudinary cleaned, notifications sent.",
  });
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
  // 1️⃣ Check if files were uploaded
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one image is required",
    });
  }

  const { title, link, placement, status } = req.body;

  const validPlacements = [
    "HomePageSlider",
    "HomePageBottomPromo",
    "CategoryTop",
    "SearchPageAd",
    "CheckoutPromo",
  ];

  const validStatus = ["Active", "Inactive"];

  const finalPlacement = validPlacements.includes(placement)
    ? placement
    : "HomePageSlider";

  const finalStatus = validStatus.includes(status) ? status : "Active";

  // 2️⃣ Upload all images to Cloudinary
  const bannerImages = [];
  for (const file of req.files) {
    const uploaded = await cloudinaryUpload(file.path, "banners"); // ✔ CLOUDINARY UPLOAD FIX
    bannerImages.push({
      imageUrl: uploaded.secure_url,
      public_id: uploaded.public_id,
      title: title || "Promotional Banner",
      link: link || "#",
      placement: finalPlacement,
      status: finalStatus,
    });
  }

  // 3️⃣ Insert into DB
  const banners = await Banner.insertMany(bannerImages);

  // 4️⃣ Response
  res.status(201).json({
    success: true,
    message: `${banners.length} banner(s) created successfully`,
    banners,
  });
});


const deleteBanner = asyncHandler(async (req, res) => {
  const bannerId = req.params.id;

  // 1️⃣ Find banner
  const banner = await Banner.findById(bannerId);
  if (!banner) {
    return res.status(404).json({
      success: false,
      message: "Banner not found",
    });
  }

  // 2️⃣ Delete Cloudinary image (safe)
  if (banner.public_id) {
    try {
      await cloudinaryDestroy(banner.public_id);   // 🔥 Correct service method
    } catch (err) {
      console.error("❌ Cloudinary deletion error:", err);
      // Continue even if Cloudinary delete fails
    }
  }

  // 3️⃣ Delete banner from DB
  await Banner.findByIdAndDelete(bannerId);

  res.status(200).json({
    success: true,
    message: "Banner deleted successfully",
    bannerId,
  });
});



const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({}, { name: 1, image: 1 }).sort({ name: 1 });

  res.json({
    success: true,
    categories,
  });
});









const createCategory = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please provide an image for the category",
    });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: "Category name is required",
    });
  }

  // Check duplicate
  const exists = await Category.findOne({ name: name.trim() });
  if (exists) {
    return res.status(400).json({
      success: false,
      message: "Category name already exists",
    });
  }

  // Upload image
  const uploaded = await cloudinaryUpload(req.file.path, "Categories");

  // Save URL only
  const category = await Category.create({
    name: name.trim(),
    image: uploaded.secure_url,
  });

  res.status(201).json({
    success: true,
    message: "Category created successfully",
    data: category,
  });
});




const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const category = await Category.findById(id);
  if (!category) {
    return res.status(404).json({
      success: false,
      message: "Category not found",
    });
  }

  // Update name
  if (name && name.trim()) {
    const exists = await Category.findOne({ _id: { $ne: id }, name: name.trim() });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Category name already exists",
      });
    }

    category.name = name.trim();
  }

  // Update image
  if (req.file) {
    const uploaded = await cloudinaryUpload(req.file.path, "Categories");
    category.image = uploaded.secure_url; // only URL stored
  }

  const updated = await category.save();

  res.json({
    success: true,
    message: "Category updated successfully",
    data: updated,
  });
});











const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1️⃣ Find category
  const category = await Category.findById(id);

  if (!category) {
    return res.status(404).json({
      success: false,
      message: "Category not found.",
    });
  }

  // 2️⃣ Delete image from Cloudinary (if exists)
  if (category.image) {
    try {
      // extract public_id from URL
      const segments = category.image.split("/");
      const fileName = segments.pop(); // xxx.png
      const publicId = fileName.split(".")[0]; // remove extension

      await cloudinaryDestroy(`Categories/${publicId}`);
    } catch (err) {
      console.error("❌ Cloudinary delete failed:", err);
      // continue even if deletion fails
    }
  }

  // 3️⃣ Delete category from DB
  await category.deleteOne();

  res.status(200).json({
    success: true,
    message: "Category deleted successfully.",
    deletedCategoryId: id,
  });
});



const getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return res.status(404).json({
      success: false,
      message: "Category not found",
    });
  }

  res.status(200).json({
    success: true,
    category: {
      _id: category._id,
      name: category.name,
      image: category.image, // URL only
    },
  });
});

const createVariety = asyncHandler(async (req, res) => {
  const { name, category } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: "Variety name is required",
    });
  }

  if (!category || !category.trim()) {
    return res.status(400).json({
      success: false,
      message: "Category name is required",
    });
  }

  // 🔎 Find category by NAME instead of ID
  const categoryDoc = await Category.findOne({ name: category.trim() });

  if (!categoryDoc) {
    return res.status(404).json({
      success: false,
      message: "Category not found with this name",
    });
  }

  // Check duplicate
  const exists = await Variety.findOne({
    name: name.trim(),
    category: categoryDoc._id,
  });

  if (exists) {
    return res.status(400).json({
      success: false,
      message: "Variety already exists under this category",
    });
  }

  const variety = await Variety.create({
    name: name.trim(),
    category: categoryDoc._id, // ID stored internally
  });

  res.status(201).json({
    success: true,
    message: "Variety created successfully",
    data: variety,
  });
});


const updateVariety = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, category } = req.body;

  const variety = await Variety.findById(id);
  if (!variety) {
    return res.status(404).json({
      success: false,
      message: "Variety not found",
    });
  }

  let categoryId = variety.category; // default old category ID

  // 🟡 If category name is sent → convert name → category ID
  if (category && category.trim()) {
    const categoryDoc = await Category.findOne({ name: category.trim() });

    if (!categoryDoc) {
      return res.status(404).json({
        success: false,
        message: "Category not found with this name",
      });
    }

    categoryId = categoryDoc._id;
  }

  const updatedName = name?.trim() || variety.name;

  // 🔵 Duplicate check (name + categoryId)
  const duplicate = await Variety.findOne({
    _id: { $ne: id },
    name: updatedName,
    category: categoryId,
  });

  if (duplicate) {
    return res.status(400).json({
      success: false,
      message: "Another variety already exists with same name in this category",
    });
  }

  // 🟢 Update fields
  variety.name = updatedName;
  variety.category = categoryId;

  const updated = await variety.save();

  res.json({
    success: true,
    message: "Variety updated successfully",
    data: updated,
  });
});



const deleteVariety = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const variety = await Variety.findById(id);
  if (!variety) {
    return res.status(404).json({
      success: false,
      message: "Variety not found",
    });
  }

  // ❗ Optional: Block delete if products use this variety
  // const productExists = await Product.findOne({ variety: id });
  // if (productExists) {
  //   return res.status(400).json({
  //     success: false,
  //     message: "Cannot delete variety because products exist under this variety",
  //   });
  // }

  await variety.deleteOne();

  res.json({
    success: true,
    message: "Variety deleted successfully",
    deletedVarietyId: id,
  });
});


const getAllVarieties = asyncHandler(async (req, res) => {
  const varieties = await Variety.find()
    .populate("category", "name image")  // get category name + image
    .sort({ name: 1 });

  res.json({
    success: true,
    varieties,
  });
});


const getVarietiesByCategory = asyncHandler(async (req, res) => {
  const { categoryName } = req.params;

  if (!categoryName || !categoryName.trim()) {
    return res.status(400).json({
      success: false,
      message: "Category name is required",
    });
  }

  // 1️⃣ Find category by NAME instead of ID
  const category = await Category.findOne({ name: categoryName.trim() });

  if (!category) {
    return res.status(404).json({
      success: false,
      message: "Category not found with this name",
    });
  }

  // 2️⃣ Find varieties under this category ID
  const varieties = await Variety.find({ category: category._id })
    .sort({ name: 1 });

  res.json({
    success: true,
    category: category.name,
    varieties,
  });
});

// ============================================================
// 🔥 CREATE COUPON — Admin/Vendor
// ============================================================
const createCoupon = asyncHandler(async (req, res) => {
  try {
    const adminId = req.user._id;

    const {
      code,
      discount,
      minimumOrder = 0,
      usageLimitPerUser = 1,
      totalUsageLimit = 0,
      startDate,
      expiryDate,
      appliesTo = [],
    } = req.body;

    // Required fields
    if (!code || !discount?.value || !discount?.type || !startDate || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (code, discount, startDate, expiryDate).",
      });
    }

    // Duplicate code check
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: "Coupon code already exists.",
      });
    }

    // Date validation
    if (new Date(expiryDate) <= new Date(startDate)) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after start date.",
      });
    }

    // ------------------------------------------------------------
    // ✔ Convert Category Names / IDs to ObjectIds
    // ------------------------------------------------------------
    let finalCategoryIds = [];

    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
      const categories = await Category.find({
        $or: [
          { _id: { $in: appliesTo.filter(id => mongoose.Types.ObjectId.isValid(id)) } },
          { name: { $in: appliesTo } }
        ]
      }).select("_id");

      if (categories.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid category names or IDs in appliesTo.",
        });
      }

      finalCategoryIds = categories.map(c => c._id);
    }

    // ------------------------------------------------------------
    // 🔥 Fetch all products from selected categories
    // ------------------------------------------------------------
    let allProducts = [];

    if (finalCategoryIds.length > 0) {
      allProducts = await Product.find({ category: { $in: finalCategoryIds } }).select("_id");
    } else {
      allProducts = await Product.find().select("_id"); // All products
    }

    const productIds = allProducts.map(p => p._id);

    // ------------------------------------------------------------
    // 🔥 Create Coupon
    // ------------------------------------------------------------
    const newCoupon = await Coupon.create({
      code: code.toUpperCase(),
      discount,
      minimumOrder,
      usageLimitPerUser,
      totalUsageLimit,
      startDate,
      expiryDate,
      appliesTo: finalCategoryIds,
      applicableProducts: productIds,
      vendor: null,
      createdBy: adminId,
    });

    // ------------------------------------------------------------
    // ⭐ Populate category names BEFORE sending response
    // ------------------------------------------------------------
    const populatedCoupon = await Coupon.findById(newCoupon._id)
      .populate({
        path: "appliesTo",
        select: "name"
      });

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully.",
      data: {
        ...populatedCoupon._doc,
        appliesTo:
          populatedCoupon.appliesTo.length > 0
            ? populatedCoupon.appliesTo.map(c => c.name)
            : ["All Products"],
      },
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


// ============================================================
// 🔥 GET ALL COUPONS — Admin/Vendor
// ============================================================
const getAdminCoupons = asyncHandler(async (req, res) => {
  const { q = "", status } = req.query;
  const user = req.user || {};

  const query = {};

  // Search filter
  if (q.trim()) {
    query.code = { $regex: q.trim(), $options: "i" };
  }

  // Status filter
  if (status) {
    query.status = status;
  }

  // Vendor restriction
  if (user.role === "vendor") {
    query.createdBy = user._id;
  }

  // Fetch coupons
  const coupons = await Coupon.find(query)
    .sort({ createdAt: -1 })
    .populate({
      path: "appliesTo",
      model: "Category",
      select: "name",
    })
    .populate({
      path: "applicableProducts",
      select: "name price images category vendor",
      populate: [
        { path: "category", select: "name" },
        { path: "vendor", select: "name" },
      ],
    })
    .populate({
      path: "createdBy",
      select: "name email role",
    });

  const now = new Date();

  const formatted = await Promise.all(
    coupons.map(async (c) => {
      let updatedStatus = c.status;

      // Auto-expire logic
      if (c.expiryDate && c.expiryDate < now && c.status !== "Expired") {
        updatedStatus = "Expired";
        await Coupon.findByIdAndUpdate(c._id, { status: "Expired" });
      }

      // ⭐ Correct appliesTo format (Category Names)
      let appliesToResult = [];

      if (c.appliesTo && c.appliesTo.length > 0) {
        appliesToResult = c.appliesTo.map((cat) => cat.name);
      } else {
        appliesToResult = ["All Products"];
      }

      return {
        id: c._id,
        code: c.code,
        discount: c.discount,
        minimumOrder: c.minimumOrder,
        totalUsageLimit: c.totalUsageLimit,
        usageLimitPerUser: c.usageLimitPerUser,
        usedCount: c.usedCount,
        status: updatedStatus,
        startDate: c.startDate,
        expiryDate: c.expiryDate,

        appliesTo: appliesToResult,

        createdBy: {
          id: c.createdBy?._id,
          name: c.createdBy?.name,
          email: c.createdBy?.email,
          role: c.createdBy?.role,
        },

        products: c.applicableProducts.map((p) => ({
          id: p._id,
          name: p.name,
          price: p.price,
          image: p.images?.[0] || null,
          categoryName: p.category?.name || "No Category",
          vendorName: p.vendor?.name || "No Vendor",
        })),
      };
    })
  );

  return res.status(200).json({
    success: true,
    count: formatted.length,
    data: formatted,
  });
});


// EXPORT
module.exports = {
  createCoupon,
  getAdminCoupons,
};








const updateCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let updates = { ...req.body };

  // 1️⃣ Validate coupon ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid coupon ID.",
    });
  }

  // 2️⃣ Protect sensitive fields
  const protectedFields = ["usedCount", "usedBy", "createdBy", "vendor"];
  protectedFields.forEach((field) => delete updates[field]);

  // 3️⃣ Uppercase coupon code
  if (updates.code) updates.code = updates.code.toUpperCase();

  // 4️⃣ Date validation
  if (updates.startDate && updates.expiryDate) {
    if (new Date(updates.expiryDate) <= new Date(updates.startDate)) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after start date.",
      });
    }
  }

  // ============================================================
  // 5️⃣ VALIDATE & CONVERT appliesTo → CATEGORY IDs
  // ============================================================

  let finalCategoryIds = [];

  if (Array.isArray(updates.appliesTo) && updates.appliesTo.length > 0) {
    const categories = await Category.find({
      $or: [
        { _id: { $in: updates.appliesTo.filter(id => mongoose.Types.ObjectId.isValid(id)) } },
        { name: { $in: updates.appliesTo } }
      ]
    }).select("_id name");

    if (categories.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid category names or IDs in appliesTo.",
      });
    }

    finalCategoryIds = categories.map((c) => c._id);
    updates.appliesTo = finalCategoryIds;
  } else {
    updates.appliesTo = []; // meaning → ALL PRODUCTS
  }

  // ============================================================
  // 6️⃣ UPDATE applicableProducts BASED ON CATEGORIES
  // ============================================================

  let allProducts;

  if (updates.appliesTo.length > 0) {
    allProducts = await Product.find({ category: { $in: updates.appliesTo } }).select("_id");
  } else {
    allProducts = await Product.find().select("_id");
  }

  updates.applicableProducts = allProducts.map((p) => p._id);

  // ============================================================
  // 7️⃣ UPDATE COUPON
  // ============================================================

  const coupon = await Coupon.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  }).populate({
    path: "appliesTo",
    select: "name",
  });

  if (!coupon) {
    return res.status(404).json({
      success: false,
      message: "Coupon not found.",
    });
  }

  // ============================================================
  // 🔥 FORMAT appliesTo → CATEGORY NAMES
  // ============================================================

  const appliesToResult =
    coupon.appliesTo.length > 0
      ? coupon.appliesTo.map((cat) => cat.name)
      : ["All Products"];

  // ============================================================
  // 8️⃣ SEND NOTIFICATIONS (unchanged)
  // ============================================================

  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  const title = "🎟️ Coupon Updated";
  const message = `Coupon "${coupon.code}" has been updated!`;

  const allUsers = await User.find({
    role: { $in: ["Admin", "Buyer", "Vendor"] },
  }).select("_id role expoPushToken");

  const notifPayloads = allUsers.map((user) => ({
    title,
    message,
    receiverId: user._id,
    userType: user.role,
    createdBy: req.user._id,
    data: {
      type: "coupon_updated",
      couponId: coupon._id,
      couponCode: coupon.code,
    },
    isRead: false,
  }));

  const savedNotifications = await Notification.insertMany(notifPayloads);

  // Socket notifications
  savedNotifications.forEach((notif) => {
    const uid = notif.receiverId.toString();
    if (onlineUsers[uid]) {
      io.to(onlineUsers[uid].socketId).emit("notification", notif);
    }
  });

  // Expo push notifications
  const pushMessages = allUsers
    .filter(
      (user) =>
        user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)
    )
    .map((user) => ({
      to: user.expoPushToken,
      sound: "default",
      title,
      body: message,
      data: {
        type: "coupon_updated",
        couponId: coupon._id,
      },
    }));

  if (pushMessages.length > 0) {
    const chunks = expo.chunkPushNotifications(pushMessages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  }

  // ============================================================
  // 9️⃣ FINAL RESPONSE (with category names)
  // ============================================================

  return res.status(200).json({
    success: true,
    message: "Coupon updated successfully.",
    data: {
      ...coupon._doc,
      appliesTo: appliesToResult,
    }
  });
});





const deleteCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const userRole = req.user.role;

  // 1️⃣ Validate ID format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid coupon ID.",
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

  // 3️⃣ Permission Check
  if (userRole === "vendor" && coupon.createdBy.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "You are not allowed to delete this coupon.",
    });
  }

  // 4️⃣ Delete coupon
  await coupon.deleteOne();

  // 5️⃣ Notification Setup
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  const title = "Coupon Deleted ❌";
  const message = `The coupon "${coupon.code}" has been deleted successfully.`;

  // 6️⃣ Notify Only the User Who Deleted (Admin or Vendor)
  const notificationPayload = {
    title,
    message,
    receiverId: userId,
    userType: userRole,
    createdBy: userId,
    data: {
      type: "coupon_deleted",
      couponId: coupon._id,
      couponCode: coupon.code,
    },
    isRead: false,
  };

  const savedNotif = await Notification.create(notificationPayload);

  // 7️⃣ Send Real-time Socket Notification
  if (onlineUsers[userId]) {
    io.to(onlineUsers[userId].socketId).emit("notification", savedNotif);
  }

  // 8️⃣ Send Expo Push Notification
  const user = await User.findById(userId).select("expoPushToken");

  if (user?.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    try {
      const messages = [
        {
          to: user.expoPushToken,
          sound: "default",
          title,
          body: message,
          data: notificationPayload.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // 9️⃣ Final Response
  res.status(200).json({
    success: true,
    message: "Coupon deleted successfully.",
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

  if (!user || user.role !== "Admin") {
    return res.status(404).json({ success: false, message: "Admin not found." });
  }

  const { name, email, upiId } = req.body;

  // ---------------------------
  // 🔹 Update Name
  // ---------------------------
  if (name) user.name = name;

  // ---------------------------
  // 🔹 Update Email
  // ---------------------------
  if (email) {
    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser._id.toString() !== req.user.id) {
      return res.status(400).json({
        success: false,
        message: "Email already exists.",
      });
    }
    user.email = email;
  }

  // ---------------------------
  // 🔹 Update UPI ID
  // ---------------------------
  if (upiId) {
    const upiPattern = /^[\w.\-_]{2,}@[a-zA-Z]{2,}$/;
    if (!upiPattern.test(upiId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid UPI ID format.",
      });
    }
    user.upiId = upiId;
  }

  // ---------------------------
  // 🔹 Profile Image Update
  // ---------------------------
  if (req.file) {
    try {
      // Delete old image
      if (user.profilePicture) {
        const oldPublicId = user.profilePicture.split("/").pop().split(".")[0];
        await cloudinaryDestroy(`admin-profiles/${oldPublicId}`);
      }

      // Upload new image using service
      const uploaded = await cloudinaryUpload(req.file.path, "admin-profiles");
      user.profilePicture = uploaded.secure_url;

    } catch (error) {
      console.error("Profile picture upload failed:", error);
      return res.status(500).json({
        success: false,
        message: "Profile picture upload failed.",
      });
    }
  }

  await user.save();

  // ---------------------------
  // 🔵 Create Personal Notification
  // ---------------------------
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  const adminId = user._id.toString();

  const title = "Profile Updated 🛠️";
  const message = "Your admin profile has been updated successfully.";

  const notificationData = {
    title,
    message,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: { action: "admin_profile_updated" },
    isRead: false,
  };

  const savedNotif = await Notification.create(notificationData);

  // 🔹 Send socket notification
  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", savedNotif);
  }

  // 🔹 Send Expo push
  if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    try {
      const messages = [
        {
          to: user.expoPushToken,
          sound: "default",
          title,
          body: message,
          data: notificationData.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // ---------------------------
  // FINAL RESPONSE
  // ---------------------------
  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
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

  // 1️⃣ Validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "All password fields are required.",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "New password and confirm password do not match.",
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters.",
    });
  }

  // 2️⃣ Find admin
  const user = await User.findById(req.user.id);
  if (!user || user.role !== "Admin") {
    return res.status(404).json({
      success: false,
      message: "Admin not found.",
    });
  }

  // 3️⃣ Check current password
  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Incorrect current password.",
    });
  }

  // 4️⃣ Update password
  user.password = newPassword;
  await user.save();

  // =================================================
  // 🔵 PERSONAL ADMIN NOTIFICATION (DB + Socket + Expo)
  // =================================================
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  const adminId = user._id.toString();

  const title = "Password Changed 🔐";
  const message = "Your admin password has been updated successfully.";

  const notifPayload = {
    title,
    message,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: { action: "admin_password_changed" },
    isRead: false,
  };

  // Save into DB
  const savedNotif = await Notification.create(notifPayload);

  // Socket real-time
  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", savedNotif);
  }

  // Expo push
  if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
    try {
      const messages = [
        {
          to: user.expoPushToken,
          sound: "default",
          title,
          body: message,
          data: notifPayload.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // =================================================
  // RESPONSE
  // =================================================
  res.status(200).json({
    success: true,
    message: "Password changed successfully.",
  });
});



const deleteAdminProfilePicture = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user || !user.profilePicture) {
    return res.status(404).json({
      success: false,
      message: "Admin or profile picture not found.",
    });
  }

  try {
    // Extract public_id correctly
    const oldPublicId = user.profilePicture.split("/").pop().split(".")[0];

    // Use cloudinaryDestroy helper
    await cloudinaryDestroy(`admin-profiles/${oldPublicId}`);

  } catch (error) {
    console.error("Cloudinary deletion failed:", error);
    // continue even if cloudinary delete fails
  }

  // Remove image from DB
  user.profilePicture = "";
  await user.save();

  res.status(200).json({
    success: true,
    message: "Profile picture deleted successfully.",
    data: { profilePicture: null },
  });
});


const getNotificationSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("notificationSettings");

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found.",
    });
  }

  res.json({
    success: true,
    notificationSettings: user.notificationSettings,
  });
});
const updateNotificationSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found.",
    });
  }

  const {
    newVendorRegistration,
    newBuyerRegistration,
    newProductRegistration,
    newOrderPlaced,
  } = req.body;

  if (newVendorRegistration !== undefined)
    user.notificationSettings.newVendorRegistration = newVendorRegistration;

  if (newBuyerRegistration !== undefined)
    user.notificationSettings.newBuyerRegistration = newBuyerRegistration;

  if (newProductRegistration !== undefined)
    user.notificationSettings.newProductRegistration = newProductRegistration;

  if (newOrderPlaced !== undefined)
    user.notificationSettings.newOrderPlaced = newOrderPlaced;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Notification settings updated successfully.",
    notificationSettings: user.notificationSettings,
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

  // 3️⃣ Activate vendor products
  await Product.updateMany(
    { vendor: id, status: "Inactive" },
    { status: "In Stock" }
  );

  // 4️⃣ Setup instances
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // ============================
  // 🟡 PERSONAL VENDOR NOTIFICATION
  // ============================
  const vendorId = vendor._id.toString();

  const title = "Account Approved 🎉";
  const message =
    "Congratulations! Your vendor account has been approved by the admin. You can now start selling your products.";

  const notifPayload = {
    title,
    message,
    receiverId: vendorId,
    userType: "Vendor",
    createdBy: req.user._id,
    data: {
      type: "vendor_approved",
      vendorId,
    },
    isRead: false,
  };

  // Save in DB
  const savedNotif = await Notification.create(notifPayload);

  // Socket.io real-time
  if (onlineUsers[vendorId]) {
    io.to(onlineUsers[vendorId].socketId).emit("notification", savedNotif);
  }

  // Expo Push Notification
  if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
    try {
      const messages = [
        {
          to: vendor.expoPushToken,
          sound: "default",
          title,
          body: message,
          data: notifPayload.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // ============================
  // ❌ NO ADMIN NOTIFICATION (as requested)
  // ============================

  // 5️⃣ Final response
  res.status(200).json({
    success: true,
    message: "Vendor approved and vendor has been notified.",
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

  // 3️⃣ Update vendor
  vendor.status = "Rejected";
  vendor.isApproved = false;
  vendor.rejectionReason = rejectionReason;
  await vendor.save();

  // 4️⃣ Deactivate products
  await Product.updateMany({ vendor: id }, { status: "Out of Stock" });

  // 5️⃣ Setup
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};
  const expo = req.app.get("expo");

  // =============================
  // 🔴 VENDOR NOTIFICATION
  // =============================
  const vendorId = vendor._id.toString();
  const vendorTitle = "Account Rejected ❌";
  const vendorMessage = `Your vendor registration was rejected. Reason: ${rejectionReason}`;

  const vendorNotifPayload = {
    title: vendorTitle,
    message: vendorMessage,
    receiverId: vendorId,
    userType: "Vendor",
    createdBy: req.user._id,
    data: {
      type: "vendor_rejected",
      vendorId,
      reason: rejectionReason,
    },
    isRead: false,
  };

  const savedVendorNotif = await Notification.create(vendorNotifPayload);

  // Socket → Vendor
  if (onlineUsers[vendorId]) {
    io.to(onlineUsers[vendorId].socketId).emit("notification", savedVendorNotif);
  }

  // Expo Push → Vendor
  if (vendor.expoPushToken && Expo.isExpoPushToken(vendor.expoPushToken)) {
    try {
      const msg = [
        {
          to: vendor.expoPushToken,
          sound: "default",
          title: vendorTitle,
          body: vendorMessage,
          data: vendorNotifPayload.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(msg);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // =============================
  // 🟩 ADMIN NOTIFICATION (self)
  // =============================
  const adminId = req.user._id.toString();
  const adminTitle = "Vendor Rejected ✅";
  const adminMessage = `You rejected vendor "${vendor.name}" for reason: "${rejectionReason}".`;

  const adminNotifPayload = {
    title: adminTitle,
    message: adminMessage,
    receiverId: adminId,
    userType: "Admin",
    createdBy: adminId,
    data: {
      type: "vendor_rejected_admin",
      vendorId,
      reason: rejectionReason,
    },
    isRead: false,
  };

  const savedAdminNotif = await Notification.create(adminNotifPayload);

  // Socket → Admin
  if (onlineUsers[adminId]) {
    io.to(onlineUsers[adminId].socketId).emit("notification", savedAdminNotif);
  }

  // Expo Push → Admin (optional)
  const adminUser = await User.findById(adminId).select("expoPushToken");
  if (adminUser.expoPushToken && Expo.isExpoPushToken(adminUser.expoPushToken)) {
    try {
      const msg = [
        {
          to: adminUser.expoPushToken,
          sound: "default",
          title: adminTitle,
          body: adminMessage,
          data: adminNotifPayload.data,
        },
      ];

      const chunks = expo.chunkPushNotifications(msg);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err) {
      console.error("Expo Push Error:", err);
    }
  }

  // =============================
  // RESPONSE
  // =============================
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
    getuserNotificationSettings, getBannersByPlacement,createVariety,updateVariety,deleteVariety,getAllVarieties,getVarietiesByCategory,
    updateuserNotificationSettings, getCustomerSupportDetails, updateCustomerSupportDetails, updateStaticPageContent
};
