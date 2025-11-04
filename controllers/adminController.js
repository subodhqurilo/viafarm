const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Category = require('../models/Category');
const Cart = require("../models/Cart");        // 👈 add this
const Wishlist = require("../models/Wishlist");
const { cloudinary, cloudinaryUpload, cloudinaryDestroy, upload } = require('../services/cloudinaryService');
const mongoose = require('mongoose');   // <-- ADD THIS
const NotificationSettings = require('../models/NotificationSettings');
const CustomerSupport = require('../models/CustomerSupport'); 
 const StaticPage = require('../models/StaticPage');
const { createAndSendNotification } = require('../utils/notificationUtils');
const Notification = require('../models/Notification');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const Address = require('../models/Address');




// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard
// @access  Private/Admin
// A simple function to calculate the numeric percentage change.

// A robust function to calculate the numeric percentage change.


// @desc    Get key dashboard statistics
// @route   GET /api/admin/dashboard/stats
// @access  Private/Admin
const calculateChange = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

// Format the change into a readable string (e.g., "+12%" or "-8%")
const formatChange = (value) => {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
};

// Main Controller
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

// @desc    Get recent activities (e.g., new registrations)
// @route   GET /api/admin/dashboard/recent-activity
// @access  Private/Admin
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

// @desc    Get all products for admin view
// @route   GET /api/admin/products
// @access  Private/Admin
const getProducts = asyncHandler(async (req, res) => {
    const { q, category, page = 1, limit = 12 } = req.query;

    const query = {};

    if (q) {
        const matchingVendors = await User.find({ 
            role: 'Vendor', 
            name: { $regex: q, $options: 'i' } 
        }).select('_id');
        const vendorIds = matchingVendors.map(vendor => vendor._id);

        query.$or = [
            { name: { $regex: q, $options: 'i' } },
            { vendor: { $in: vendorIds } }
        ];
    }
    
    if (category) {
        query.category = { $regex: category, $options: 'i' };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalProducts = await Product.countDocuments(query);

    const products = await Product.find(query)
        .populate('vendor', 'name')
        .select('name category price unit createdAt') // Explicitly select the required fields, including 'price' and 'unit'
        .limit(parseInt(limit))
        .skip(skip)
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        data: products,
        page: parseInt(page),
        pages: Math.ceil(totalProducts / parseInt(limit)),
        total: totalProducts,
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









// @desc    Delete a product
// @route   DELETE /api/admin/products/:id
// @access  Private/Admin
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
    const { q, status, page = 1, limit = 12 } = req.query;

    const query = { role: 'Vendor' };

    // Search by name
    if (q) {
        query.name = { $regex: q, $options: 'i' };
    }

    // Filter by status
    if (status) {
        query.status = status;
    }

    const vendors = await User.find(query)
        .select('name address mobileNumber status profilePicture') // Ensure 'address' is included
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .sort({ createdAt: -1 });

    const totalVendors = await User.countDocuments(query);

    res.status(200).json({
        success: true,
        data: vendors.map(vendor => ({
            _id: vendor._id,
            name: vendor.name,
            mobileNumber: vendor.mobileNumber,
            status: vendor.status,
            profilePicture: vendor.profilePicture,
            address: vendor.address // Include full address object
        })),
        page: parseInt(page),
        pages: Math.ceil(totalVendors / parseInt(limit)),
        total: totalVendors
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
  );

  if (!vendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found." });
  }

  // 2️⃣ Mark all products inactive
  await Product.updateMany({ vendor: id }, { status: "Inactive" });

  // 3️⃣ Get socket info
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers");

  // 🟡 Notify vendor personally
  if (onlineUsers[vendor._id]) {
    io.to(onlineUsers[vendor._id].socketId).emit("notification", {
      title: "Account Deleted 🛑",
      message:
        "Your vendor account has been deleted by the admin. All your products are now inactive.",
      type: "error",
    });
  }

  // 🟢 Notify admin (the one performing deletion)
  if (onlineUsers[req.user._id]) {
    io.to(onlineUsers[req.user._id].socketId).emit("notification", {
      title: "Vendor Deleted ✅",
      message: `You have successfully deleted vendor "${vendor.name}".`,
      type: "success",
    });
  }

  // 4️⃣ Send response
  res.status(200).json({
    success: true,
    message:
      "Vendor account and their products have been deactivated successfully.",
  });
});


// @desc    Block a vendor
// @route   PUT /api/admin/vendors/:id/block
// @access  Private/Admin



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




// @desc    Get all buyers for admin view
// @route   GET /api/admin/buyers
// @access  Private/Admin
// controllers/adminController.js

// controllers/adminController.js
// controllers/adminController.js

const getBuyers = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const buyers = await User.aggregate([
    { $match: { role: "Buyer" } },

    // ✅ Lookup total orders as Buyer (safe ObjectId comparison)
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

    { $sort: { createdAt: -1 } }, // recent buyers first
    { $skip: skip },
    { $limit: limit }
  ]);

  const total = await User.countDocuments({ role: "Buyer" });

  res.status(200).json({
    success: true,
    data: buyers,
    page,
    pages: Math.ceil(total / limit),
    total
  });
});














// @desc    Block a buyer
// @route   PUT /api/admin/buyers/:id/block
// @access  Private/Admin
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

// @desc    Delete a user (buyer or vendor)
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
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

// @desc    Get all orders for admin view
// @route   GET /api/admin/orders
// @access  Private/Admin
// @desc    Get a paginated list of all orders for admin view
// @route   GET /api/admin/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 12 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base match stage for initial filtering
    const matchStage = {};

    // Search condition for buyer name, vendor name, or orderId
    const searchStage = q ? {
        $or: [
            { orderId: { $regex: q, $options: "i" } },
            { "buyerInfo.name": { $regex: q, $options: "i" } },
            { "vendorInfo.name": { $regex: q, $options: "i" } }
        ]
    } : {};

    // --- Aggregation pipeline for fetching orders ---
    const pipeline = [
        // 1. Initial match for optional filters
        { $match: matchStage },
        // 2. Lookup buyer info from 'users' collection
        {
            $lookup: {
                from: "users",
                localField: "buyer",
                foreignField: "_id",
                as: "buyerInfo"
            }
        },
        { $unwind: "$buyerInfo" },
        // 3. Lookup vendor info from 'users' collection
        {
            $lookup: {
                from: "users",
                localField: "vendor",
                foreignField: "_id",
                as: "vendorInfo"
            }
        },
        { $unwind: "$vendorInfo" },
        // 4. Match search query on joined fields
        { $match: searchStage },
        // 5. Sort by creation date (newest first)
        { $sort: { createdAt: -1 } },
        // 6. Apply Pagination
        { $skip: skip },
        { $limit: parseInt(limit) },
        // 7. Project the final output fields and format status
        {
            $project: {
                _id: 1,
                orderId: 1,
                totalPrice: 1,
                createdAt: 1,
                // ✅ Correctly project buyer and vendor names
                buyer: "$buyerInfo.name",
                vendor: "$vendorInfo.name",
                action: "View", // Hardcoded as per the image
                // ✅ FIX: Use a correct $switch condition to map status values
                status: {
                    $switch: {
                        branches: [
                            // Data in DB: 'In-process' -> Display: 'In Process'
                            { case: { $eq: ["$orderStatus", "In-process"] }, then: "In Process" },
                            // Data in DB: 'Confirmed' -> Display: 'In Process' (as per image)
                            { case: { $eq: ["$orderStatus", "Confirmed"] }, then: "In Process" },
                            // Data in DB: 'Completed' -> Display: 'Completed'
                            { case: { $eq: ["$orderStatus", "Completed"] }, then: "Completed" },
                            // Data in DB: 'Cancelled' -> Display: 'Cancelled'
                            { case: { $eq: ["$orderStatus", "Cancelled"] }, then: "Cancelled" }
                        ],
                        // If no other cases match, default to 'Unknown'
                        default: "Unknown"
                    }
                }
            }
        }
    ];

    // --- Count pipeline for pagination (Unchanged, but uses a corrected $match stage) ---
    const countPipeline = [
        { $match: matchStage },
        {
            $lookup: { from: "users", localField: "buyer", foreignField: "_id", as: "buyerInfo" }
        },
        { $unwind: "$buyerInfo" },
        {
            $lookup: { from: "users", localField: "vendor", foreignField: "_id", as: "vendorInfo" }
        },
        { $unwind: "$vendorInfo" },
        { $match: searchStage },
        { $count: "total" }
    ];

    // Execute both pipelines in parallel
    const [orders, countResult] = await Promise.all([
        Order.aggregate(pipeline),
        Order.aggregate(countPipeline)
    ]);

    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    res.status(200).json({
        success: true,
        data: orders,
        page: parseInt(page),
        pages: Math.ceil(totalCount / parseInt(limit)),
        total: totalCount,
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










// @desc    Delete an order
// @route   DELETE /api/admin/orders/:id
// @access  Private/Admin
const deleteOrder = asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (order) {
        await order.remove();
        res.json({ message: 'Order removed' });
    } else {
        res.status(404).json({ message: 'Order not found' });
    }
});

// @desc    Get all banners
// @route   GET /api/admin/settings/banners
// @access  Private/Admin
const getBanners = asyncHandler(async (req, res) => {
    const { placement, status } = req.query;

    // Build query object
    const query = {};
    if (placement) query.placement = placement;
    if (status) query.status = status;

    // Fetch banners
    const banners = await Banner.find(query).sort({ createdAt: -1 }); // newest first
    console.log("banner",banners)
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


// @desc    Create a new banner
// @route   POST /api/admin/settings/banners
// @access  Private/Admin

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





// @desc    Delete a banner
// @route   DELETE /api/admin/settings/banners/:id
// @access  Private/Admin
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



// @desc    Get all categories
// @route   GET /api/admin/manage-app/categories
// @access  Private/Admin
const getCategories = asyncHandler(async (req, res) => {
    const categories = await Category.find({}).sort({ name: 1 }); // optional: sort alphabetically
    res.json(categories);
});


// @desc    Create a product category
// @route   POST /api/admin/manage-app/categories
// @access  Private/Admin
const createCategory = asyncHandler(async (req, res) => {
    const { name } = req.body;

    if (!req.file) {
        res.status(400);
        throw new Error("Please provide an image for the category");
    }

    // Use cloudinaryUpload helper function
    const result = await cloudinaryUpload(req.file.path, 'categories');

    const category = await Category.create({
        name,
        image: {
            url: result.secure_url,
            public_id: result.public_id
        }
    });

    res.status(201).json(category);
});




// @desc    Update a category
// @route   PUT /api/admin/manage-app/categories/:id
// @access  Private/Admin
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



// @desc    Delete a category
// @route   DELETE /api/admin/manage-app/categories/:id
// @access  Private/Admin
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

// @desc    Get all coupons
// @route   GET /api/admin/manage-app/coupons
// @access  Private/Admin
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
            appliesTo = [], // e.g. ['All Products'] or ['Fruits', 'Plants']
            applicableProducts = [] // Optional: product IDs
        } = req.body;

        // 1️⃣ Required fields
        if (!code || !discount || !discount.value || !discount.type || !startDate || !expiryDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields (code, discount, startDate, expiryDate).'
            });
        }

        // 2️⃣ Check if coupon code already exists
        const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (existingCoupon) {
            return res.status(400).json({ success: false, message: 'Coupon code already exists.' });
        }

        // 3️⃣ Validate dates
        if (new Date(expiryDate) <= new Date(startDate)) {
            return res.status(400).json({
                success: false,
                message: 'Expiry date must be after start date.'
            });
        }

        // 4️⃣ Normalize data
        const upperCaseCode = code.toUpperCase();

        // 5️⃣ Create the coupon
        const newCoupon = await Coupon.create({
            code: upperCaseCode,
            discount,
            minimumOrder,
            usageLimitPerUser,
            totalUsageLimit,
            startDate,
            expiryDate,
            appliesTo: appliesTo.length > 0 ? appliesTo : ['All Products'],
            applicableProducts,
            vendor: null, // null = global (admin coupon)
            createdBy: adminId
        });

        // 6️⃣ Response
        res.status(201).json({
            success: true,
            message: 'Coupon created successfully.',
            data: newCoupon
        });
    } catch (error) {
        console.error('❌ Error creating coupon:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create coupon.',
            error: error.message
        });
    }
});





// @desc    Get all coupons
// @route   GET /api/admin/coupons
// @access  Private/Admin
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








// @desc    Update a coupon by ID
// @route   PUT /api/admin/coupons/:id
// @access  Private/Admin
const updateCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = { ...req.body };

    // 1️⃣ Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid coupon ID.' });
    }

    // 2️⃣ Protect system fields
    const protectedFields = ['usedCount', 'usedBy', 'createdBy', 'vendor'];
    protectedFields.forEach(field => delete updates[field]);

    // 3️⃣ Auto uppercase coupon code
    if (updates.code) {
        updates.code = updates.code.toUpperCase();
    }

    // 4️⃣ Validate category (appliesTo)
    if (updates.appliesTo) {
        const validCategories = ['All Products', 'Fruits', 'Vegetables', 'Plants', 'Seeds', 'Handicrafts'];
        const invalid = updates.appliesTo.filter(cat => !validCategories.includes(cat));
        if (invalid.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Invalid category in appliesTo: ${invalid.join(', ')}`
            });
        }
    }

    // 5️⃣ Validate dates
    if (updates.startDate && updates.expiryDate) {
        if (new Date(updates.expiryDate) <= new Date(updates.startDate)) {
            return res.status(400).json({
                success: false,
                message: 'Expiry date must be after start date.'
            });
        }
    }

    // 6️⃣ Update coupon
    const coupon = await Coupon.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true
    });

    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    // 7️⃣ Response
    res.status(200).json({
        success: true,
        message: 'Coupon updated successfully.',
        data: coupon
    });
});



// @desc    Delete a coupon by ID
// @route   DELETE /api/admin/coupons/:id
// @access  Private/Admin
const deleteCoupon = asyncHandler(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
        return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    await coupon.deleteOne();

    res.status(200).json({
        success: true,
        message: 'Coupon deleted successfully'
    });
});

// @desc    Get admin profile
// @route   GET /api/admin/settings/profile
// @access  Private/Admin
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



// @desc    Update admin profile
// @route   PUT /api/admin/settings/profile
// @access  Private/Admin
// controllers/adminController.js
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






// @desc    Change admin password
// @route   POST /api/admin/settings/change-password
// @access  Private/Admin
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




// @desc    Get notification settings
// @route   GET /api/admin/settings/notifications
// @access  Private/Admin
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

// @desc    Update notification settings
// @route   PUT /api/admin/settings/notifications
// @access  Private/Admin
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

// @desc    Update or Create content for a static page (PUT /api/admin/static-pages/:pageName)
// @access  Private/Admin
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




// @desc    Update content of a specific static page
// @route   PUT /api/admin/manage-app/:pageName
// @access  Private/Admin
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

// @desc    Create content for a specific static page
// @route   POST /api/admin/manage-app/pages
// @access  Private/Admin
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

// @desc    Update notification settings
// @route   PUT /api/admin/notifications
// @access  Private/Admin
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





/**
 * @desc    Approve a Vendor (set status to 'Active', mark approved = true)
 * @route   PUT /api/admin/vendors/:id/approve
 * @access  Private/Admin
 */
const approveVendor = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find the vendor
  const vendor = await User.findOne({ _id: id, role: 'Vendor' });
  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor not found.',
    });
  }

  // Update vendor details
  vendor.status = 'Active';
  vendor.isApproved = true;
  await vendor.save();

  // Optionally, activate their products if they were inactive
  await Product.updateMany({ vendor: id, status: 'Inactive' }, { status: 'In Stock' });

  res.status(200).json({
    success: true,
    message: '✅ Vendor approved successfully.',
    data: {
      vendorId: vendor._id,
      name: vendor.name,
      email: vendor.email,
      status: vendor.status,
      isApproved: vendor.isApproved,
    },
  });
});


/**
 * @desc    Reject a Vendor (set status to 'Blocked', mark approved = false)
 * @route   PUT /api/admin/vendors/:id/reject
 * @access  Private/Admin
 */

/**
 * @desc    Reject a Vendor, set status to 'Rejected', mark approved = false, and save the reason.
 * @route   PUT /api/admin/vendors/:id/reject
 * @access  Private/Admin
 */
const rejectVendor = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // ✅ 1. Get the reason from the request body
    const { rejectionReason } = req.body; 

    // Basic validation for the rejection reason
    if (!rejectionReason || rejectionReason.trim().length < 5) {
        return res.status(400).json({
            success: false,
            message: 'Rejection reason is required and must be at least 5 characters long.'
        });
    }

    // 2. Find the vendor
    const vendor = await User.findOne({ _id: id, role: 'Vendor' });
    if (!vendor) {
        return res.status(404).json({
            success: false,
            message: 'Vendor not found.',
        });
    }

    // 3. Update vendor details
    vendor.status = 'Rejected'; // Using 'Rejected' for clarity
    vendor.isApproved = false;
    
    // ✅ 4. Save the rejection reason to the vendor document
    // NOTE: This requires the 'rejectionReason' field to exist in your User/Vendor model schema.
    vendor.rejectionReason = rejectionReason; 
    
    await vendor.save();

    // 5. Deactivate all their products
    await Product.updateMany({ vendor: id }, { status: 'Out of Stock' });

    res.status(200).json({
        success: true,
        message: '❌ Vendor rejected and reason saved successfully.',
        data: {
            vendorId: vendor._id,
            name: vendor.name,
            email: vendor.email,
            status: vendor.status,
            isApproved: vendor.isApproved,
            // ✅ Include the saved reason in the response
            rejectionReason: vendor.rejectionReason, 
        },
    });
});








module.exports = {
    getDashboardStats,
    getProducts,approveVendor,
    getAdminProductDetails,
    addOrUpdateNutritionalValue,
    deleteProduct,
    getVendors,
    getVendorDetails,
    updateVendorStatus,rejectVendor,
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
    getuserNotificationSettings,getBannersByPlacement,
    updateuserNotificationSettings,getCustomerSupportDetails,updateCustomerSupportDetails,updateStaticPageContent
};
