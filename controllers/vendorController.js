const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Category = require('../models/Category');
const Variety = require('../models/Variety');
    
  // ⭐ Review model (if needed)

const { cloudinary, cloudinaryUpload, cloudinaryDestroy } = require("../services/cloudinaryService");

const Coupon = require('../models/Coupon');
const Address = require('../models/Address');
const Notification = require('../models/Notification');
const { addressToCoords, coordsToAddress } = require('../utils/geocode');
const axios = require('axios');
const Review = require('../models/Review');

const { createAndSendNotification } = require('../utils/notificationUtils');
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const NotificationSettings = require('../models/NotificationSettings');


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
    const vendorId = req.user._id;
    const { category, search } = req.query;

    let filter = {
        status: "In Stock",
        vendor: vendorId
    };

    if (category && category !== "All") {
        filter.category = category;
    }

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } }
        ];
    }

    const products = await Product.find(filter)
        .populate("vendor", "name profilePicture")
        .populate("category", "name")   // ⭐ only name
        .sort({ datePosted: -1 })
        .limit(20);

    // ⭐ Format response to remove unwanted fields
    const formatted = products.map(p => ({
        id: p._id,
        name: p.name,
        description: p.description,
        price: p.price,
        quantity: p.quantity,
        unit: p.unit,
        images: p.images,
        status: p.status,
        vendor: {
            id: p.vendor?._id,
            name: p.vendor?.name || "",
            profilePicture: p.vendor?.profilePicture || ""
        },
        category: p.category?.name || "Unknown",   // ⭐ Only name returned
        datePosted: p.datePosted
    }));

    res.status(200).json({
        success: true,
        count: formatted.length,
        products: formatted
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

    // 1️⃣ Products with category + reviews + reviewer info
    const products = await Product.find({ vendor: vendorId })
        .populate("category", "name")
        .populate({
            path: "reviews",
            select: "rating comment images createdAt user",
            populate: {
                path: "user",
                select: "name profilePicture"
            }
        });

    const cleanProducts = products.map(p => {
        const obj = p.toObject();

        obj.category = obj.category?.name || null;

        obj.reviews = obj.reviews?.map(r => ({
            _id: r._id,
            rating: r.rating,
            comment: r.comment,
            images: r.images || [],
            createdAt: r.createdAt,
            user: r.user
                ? {
                    _id: r.user._id,
                    name: r.user.name,
                    profilePicture: r.user.profilePicture || null
                  }
                : null
        })) || [];

        return obj;
    });

    res.json({
        success: true,
        count: cleanProducts.length,
        data: cleanProducts
    });
});






const addProduct = asyncHandler(async (req, res) => {
    console.log("🔵 ADD PRODUCT API HIT");

    try {
        const {
            name, category, variety, price, quantity, unit,
            description, weightPerPiece, allIndiaDelivery
        } = req.body;

        const vendorId = req.user?._id;

        if (!vendorId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const vendor = await User.findById(vendorId);

        if (!vendor || !vendor.isApproved) {
            return res.status(403).json({ success: false, message: "Vendor not approved" });
        }

        if (!name || !category || !variety || !price || !quantity || !unit) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields",
            });
        }

        if (isNaN(price) || isNaN(quantity) || price <= 0 || quantity <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid price/quantity",
            });
        }

        // -------------------------------------------
        // 🔥 1. Find Category (by name OR id)
        // -------------------------------------------
        let categoryId;

        if (mongoose.isValidObjectId(category)) {
            categoryId = category;
        } else {
            const cat = await Category.findOne({
                name: { $regex: new RegExp(`^${category.trim()}$`, "i") }
            });

            if (!cat) {
                return res.status(400).json({
                    success: false,
                    message: `Category "${category}" not found`,
                });
            }

            categoryId = cat._id;
        }

        // -------------------------------------------
        // 🔥 2. Upload Images to Cloudinary
        // -------------------------------------------
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one product image is required",
            });
        }

        const images = [];  // <-- STRING array required by your schema

        for (const file of req.files) {
            const uploaded = await cloudinary.uploader.upload(file.path, {
                folder: "products",
            });

            // ⭐ Save ONLY url (your schema needs string)
            images.push(uploaded.secure_url);
        }

        // -------------------------------------------
        // 🔥 3. Create Product
        // -------------------------------------------
        const newProduct = await Product.create({
            name: name.trim(),
            vendor: vendorId,
            category: categoryId,
            variety: variety.trim(),
            price: Number(price),
            quantity: Number(quantity),
            unit: unit.trim(),
            description: description?.trim() || "No description provided.",
            images,  // <-- now string array
            allIndiaDelivery: allIndiaDelivery === "true" || allIndiaDelivery === true,
            status: "In Stock",
            weightPerPiece: unit === "pc" ? weightPerPiece : null,
        });

        // -------------------------------------------
        // 🔥 4. Notifications (Buyer, Admin, Vendor)
        // -------------------------------------------
        try {
            await createAndSendNotification(
                req,
                "🛒 New Product Available!",
                `Check out the new product "${newProduct.name}".`,
                { type: "product", productId: newProduct._id },
                "Buyer"
            );

            await createAndSendNotification(
                req,
                "🆕 New Product Added",
                `${vendor.name} added a new product "${newProduct.name}".`,
                { type: "product", productId: newProduct._id },
                "Admin"
            );

            await createAndSendNotification(
                req,
                "✅ Product Added Successfully",
                `Your product "${newProduct.name}" is now live.`,
                { type: "product", productId: newProduct._id },
                "Vendor",
                vendorId,
                { disablePush: true }
            );
        } catch (notifyErr) {
            console.error("❌ Notification Error:", notifyErr.message);
        }

        // -------------------------------------------
        // 🔥 5. Response
        // -------------------------------------------
        return res.status(201).json({
            success: true,
            message: "Product added successfully.",
            data: newProduct,
        });

    } catch (err) {
        console.error("🔥 CONTROLLER ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: err.message,
        });
    }
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
    return res.status(401).json({
      success: false,
      message: "Not authorized to update this product.",
    });
  }

  // 3️⃣ Allowed fields
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

  // 4️⃣ Convert Category Name → ID
  if (updates.category) {
    let categoryId;

    if (mongoose.isValidObjectId(updates.category)) {
      categoryId = updates.category;
    } else {
      const cat = await Category.findOne({
        name: { $regex: new RegExp(`^${updates.category.trim()}$`, "i") },
      });
      if (!cat) {
        return res.status(400).json({
          success: false,
          message: `Category "${updates.category}" not found.`,
        });
      }
      categoryId = cat._id;
    }

    updateFields.category = categoryId;
  }

  // 5️⃣ Process remaining allowed fields
  for (const field of allowedFields) {
    if (updates[field] !== undefined && field !== "category") {
      if (field === "price" || field === "quantity") {
        updateFields[field] = Number(updates[field]);
      } else if (field === "allIndiaDelivery") {
        updateFields[field] =
          updates[field] === true || updates[field] === "true";
      } else {
        updateFields[field] =
          typeof updates[field] === "string"
            ? updates[field].trim()
            : updates[field];
      }
    }
  }

  // 6️⃣ Validate weightPerPiece
  const finalUnit = updateFields.unit || product.unit;
  if (finalUnit === "pc") {
    const weight = updateFields.weightPerPiece || product.weightPerPiece;
    if (!weight) {
      return res.status(400).json({
        success: false,
        message: 'When selling by "pc", weightPerPiece is required.',
      });
    }
    updateFields.weightPerPiece = weight;
  } else {
    updateFields.weightPerPiece = null;
  }

  // 7️⃣ IMAGE UPLOAD (Fixed for images: [String])
  if (req.files && req.files.length > 0) {
    try {
      // 🗑 Delete OLD images (based on URL)
      if (product.images && product.images.length > 0) {
        for (const imgUrl of product.images) {
          const publicId = imgUrl
            .split("/")
            .pop()
            .split(".")[0];
          await cloudinary.uploader.destroy(`products/${publicId}`);
        }
      }

      // 📤 Upload NEW images
      const uploadedImages = [];
      for (const file of req.files) {
        const uploaded = await cloudinary.uploader.upload(file.path, {
          folder: "products",
        });

        uploadedImages.push(uploaded.secure_url); // ⬅ only URL saved
      }

      updateFields.images = uploadedImages;
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Image upload failed.",
        error: err.message,
      });
    }
  }

  // Old price
  const oldPrice = product.price;

  // 8️⃣ Update DB
  const updatedProduct = await Product.findByIdAndUpdate(
    id,
    { $set: updateFields },
    { new: true, runValidators: true }
  ).populate("vendor", "name _id");

  // 9️⃣ Notifications

  // Vendor bell only
  await createAndSendNotification(
    req,
    "✅ Product Updated",
    `Your product "${updatedProduct.name}" was updated successfully.`,
    {
      type: "product_update",
      productId: updatedProduct._id,
      oldPrice,
      newPrice: updatedProduct.price,
    },
    "Vendor",
    updatedProduct.vendor._id,
    { disablePush: true }
  );

  await createAndSendNotification(
    req,
    "🛍️ Product Updated",
    `Vendor ${updatedProduct.vendor.name} updated product "${updatedProduct.name}".`,
    {
      type: "product_update",
      productId: updatedProduct._id,
      oldPrice,
      newPrice: updatedProduct.price,
    },
    "Admin"
  );

  if (
    updateFields.price !== undefined &&
    Number(updateFields.price) < Number(oldPrice)
  ) {
    await createAndSendNotification(
      req,
      "💰 Price Drop Alert!",
      `"${updatedProduct.name}" is now ₹${updateFields.price} (was ₹${oldPrice}).`,
      {
        type: "price_drop",
        productId: updatedProduct._id,
        oldPrice,
        newPrice: updateFields.price,
      },
      "Buyer"
    );
  }

  return res.status(200).json({
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

    // 2️⃣ Find Product + Vendor + Reviews
    const product = await Product.findById(id)
        .populate({
            path: 'vendor',
            select: 'name mobileNumber email address vendorDetails.about profilePicture'
        })
        .populate({
            path: 'reviews',
            populate: {
                path: 'user',
                select: 'name profilePicture'
            }
        })
        .lean();

    // 3️⃣ Product Not Found
    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found.'
        });
    }

    // ⭐ Format Reviews
    const formattedReviews = (product.reviews || []).map(r => ({
        _id: r._id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        user: r.user
            ? {
                  _id: r.user._id,
                  name: r.user.name,
                  profilePicture: r.user.profilePicture || null
              }
            : null
    }));

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

        reviews: formattedReviews,  // ⭐ Added
        rating: product.rating,     // ⭐ Avg rating
        ratingCount: product.ratingCount,

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
      message: "Invalid product ID.",
    });
  }

  // 2️⃣ Find Product
  const product = await Product.findById(id).populate("vendor", "_id name");

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  // 3️⃣ Authorization
  if (product.vendor._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to delete this product.",
    });
  }

  // 4️⃣ Delete Cloudinary Images (✔ Fixed for [String] schema)
  if (product.images && product.images.length > 0) {
    for (const imageUrl of product.images) {
      try {
        // Extract public_id from URL
        const publicId = imageUrl
          .split("/")
          .pop()
          .split(".")[0];

        await cloudinaryDestroy(`products/${publicId}`);

      } catch (err) {
        console.error("❌ Cloudinary deletion failed:", err.message);
      }
    }
  }

  // 5️⃣ Delete Product from DB
  await product.deleteOne();

  // 6️⃣ Vendor Notification (Bell Only)
  await createAndSendNotification(
    req,
    "🗑️ Product Deleted",
    `Your product "${product.name}" has been deleted successfully.`,
    {
      productId: product._id,
      action: "product_deleted",
    },
    "Vendor",
    product.vendor._id,
    { disablePush: true }
  );

  // 7️⃣ Response
  res.status(200).json({
    success: true,
    message: "Product deleted successfully.",
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

  const order = await Order.findById(req.params.id)
    .populate("buyer vendor", "name _id email expoPushToken");

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found." });
  }

  // Vendor Authorization
  if (order.vendor._id.toString() !== req.user._id.toString()) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to update this order.",
    });
  }

  // Update Order Status
  order.orderStatus = status;
  const updatedOrder = await order.save();

  // -----------------------------------------
  // 🔔📱 Buyer Notification (Bell + Push)
  // -----------------------------------------
  await createAndSendNotification(
    req,
    "📦 Order Status Updated",
    `Your order (${order.orderId}) is now "${status}".`,
    {
      orderId: order.orderId,
      status,
      vendorId: order.vendor._id,
      vendorName: order.vendor.name,
    },
    "Buyer",
    order.buyer._id
  );

  // -----------------------------------------
  // 🔔📱 Vendor Notification (Bell + Push)
  // -----------------------------------------
  await createAndSendNotification(
    req,
    "📦 Order Status Updated",
    `Order (${order.orderId}) status updated to "${status}".`,
    {
      orderId: order.orderId,
      status,
      buyerId: order.buyer._id,
      buyerName: order.buyer.name,
    },
    "Vendor",
    order.vendor._id
  );

  // Prepare Response
  const responseOrder = updatedOrder.toObject();
  responseOrder.status = responseOrder.orderStatus;
  delete responseOrder.orderStatus;

  res.status(200).json({
    success: true,
    message: `Order status updated to "${status}" and both buyer & vendor notified.`,
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
    ).select("name role status mobileNumber expoPushToken");

    if (!updatedUser) {
        return res
            .status(404)
            .json({ success: false, message: "User not found." });
    }

    // -----------------------------------------
    // 3️⃣ 🔔📱 PERSONAL Vendor Notification (Bell + Push)
    // -----------------------------------------
    const vendorMessage =
        status === "Active"
            ? "Your store is now active. Buyers can now place orders."
            : "Your store is now inactive. Buyers will not see your products.";

    await createAndSendNotification(
        req,
        "Store Status Updated ⚙️",
        vendorMessage,
        {
            vendorId: updatedUser._id,
            vendorName: updatedUser.name,
            status,
        },
        "Vendor",        // role → vendor
        updatedUser._id  // 🎯 personal vendor
    );

    // -----------------------------------------

    // 4️⃣ Response
    res.status(200).json({
        success: true,
        message: `Your status has been updated to ${status}.`,
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
    let {
        code,
        discountValue,
        discountType = "Percentage",
        minimumOrder = 0,
        usageLimitPerUser = 1,
        totalUsageLimit,
        startDate,
        expiryDate,
        appliesTo,
        productIds = [],
        status = "Active"
    } = req.body;

    const creatorId = req.user._id;

    // ----------------------------
    // VALIDATION
    // ----------------------------
    if (!code || !discountValue || !startDate || !expiryDate) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    if (!["Fixed", "Percentage"].includes(discountType)) {
        return res.status(400).json({ success: false, message: "Invalid discountType." });
    }

    const exists = await Coupon.findOne({ code: code.toUpperCase() });
    if (exists) {
        return res.status(400).json({ success: false, message: "Coupon code already exists." });
    }

    const startD = new Date(startDate);
    const endD = new Date(expiryDate);

    if (endD <= startD) {
        return res.status(400).json({ success: false, message: "Expiry date must be after start date." });
    }

    // ----------------------------------------------------
    // 🔥 CATEGORY NAME → ID AUTO DETECT
    // ----------------------------------------------------
    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        const categories = await Category.find({
            $or: [
                { _id: { $in: appliesTo.filter(id => mongoose.Types.ObjectId.isValid(id)) } },
                { name: { $in: appliesTo } }
            ]
        }).select("_id name");

        if (categories.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid category names or IDs."
            });
        }

        appliesTo = categories.map(c => c._id);
    }

    let finalApplicable = [];
    let isUniversal = false;

    // ----------------------------------------------------
    // 🔥 UNIVERSAL APPLIES TO
    // ----------------------------------------------------
    if (appliesTo === "All Products" || appliesTo === "All Categories") {
        isUniversal = true;
    }

    // ----------------------------------------------------
    // 🔥 SPECIFIC CATEGORY LOGIC
    // ----------------------------------------------------
    else if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        if (productIds.length === 0) {
            const products = await Product.find({
                vendor: creatorId,
                category: { $in: appliesTo }
            }).select("_id");

            if (products.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No products found under selected categories."
                });
            }

            finalApplicable = products.map(p => p._id);
        } else {
            const products = await Product.find({
                _id: { $in: productIds },
                vendor: creatorId,
                category: { $in: appliesTo }
            }).select("_id");

            if (products.length !== productIds.length) {
                return res.status(403).json({
                    success: false,
                    message: "Invalid product(s) selected."
                });
            }

            finalApplicable = products.map(p => p._id);
        }
    }

    // ----------------------------------------------------
    // 🔥 SPECIFIC PRODUCT ONLY
    // ----------------------------------------------------
    else if (appliesTo === "Specific Product") {
        const products = await Product.find({
            _id: { $in: productIds },
            vendor: creatorId
        }).select("_id");

        if (products.length !== productIds.length) {
            return res.status(403).json({
                success: false,
                message: "Some products do not belong to vendor."
            });
        }

        finalApplicable = products.map(p => p._id);
    }

    else {
        return res.status(400).json({
            success: false,
            message: "Invalid appliesTo."
        });
    }

    // ----------------------------------------------------
    // 🔥 CREATE COUPON IN DB
    // ----------------------------------------------------
    let newCoupon = await Coupon.create({
        code: code.toUpperCase(),
        discount: { value: discountValue, type: discountType },
        appliesTo,
        applicableProducts: isUniversal ? [] : finalApplicable,
        startDate: startD,
        expiryDate: endD,
        minimumOrder,
        usageLimitPerUser,
        totalUsageLimit,
        status,
        vendor: creatorId,
        createdBy: creatorId
    });

    // ----------------------------------------------------
    // 🔥 RE-FETCH WITH POPULATION
    // ----------------------------------------------------
    newCoupon = await Coupon.findById(newCoupon._id)
        .populate("appliesTo", "name")
        .populate({
            path: "applicableProducts",
            select: "name price images category",
            populate: {
                path: "category",
                select: "name"
            }
        });

    // ----------------------------------------------------
    // 🔥 FINAL FORMATTED RESPONSE (same as getVendorCoupons)
    // ----------------------------------------------------
    const formatted = {
        id: newCoupon._id,
        code: newCoupon.code,
        discount: newCoupon.discount,
        minimumOrder: newCoupon.minimumOrder,
        totalUsageLimit: newCoupon.totalUsageLimit,
        usageLimitPerUser: newCoupon.usageLimitPerUser,
        status: newCoupon.status,
        startDate: newCoupon.startDate,
        expiryDate: newCoupon.expiryDate,

        // category names
        appliesTo: Array.isArray(newCoupon.appliesTo)
            ? newCoupon.appliesTo.map(cat => ({
                id: cat?._id,
                name: cat?.name
            }))
            : [],

        // products
        products: newCoupon.applicableProducts?.map(p => ({
            id: p._id,
            name: p.name,
            price: p.price,
            image: p.images?.[0] || null,
            categoryName: p.category?.name || null
        })) || [],

        vendor: newCoupon.vendor,
        createdBy: newCoupon.createdBy,
        createdAt: newCoupon.createdAt,
        updatedAt: newCoupon.updatedAt
    };

    return res.status(201).json({
        success: true,
        message: "Coupon created successfully.",
        data: formatted
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

    const query = { vendor: vendorId };

    // Status filter
    const allowedStatuses = ['Active', 'Expired', 'Disabled'];
    if (status && allowedStatuses.includes(status)) {
        query.status = status;
    }

    // Search by coupon code
    if (search.trim()) {
        query.code = { $regex: search.trim(), $options: "i" };
    }

    // 🔥 Populate vendor, applicable products, and categories
    const coupons = await Coupon.find(query)
        .sort({ createdAt: -1 })
        .populate({
            path: "vendor",
            select: "name profilePicture"
        })
        .populate({
            path: "appliesTo",             // NEW → Only works because schema fixed
            select: "name"
        })
        .populate({
            path: "applicableProducts",
            select: "name price images category vendor",
            populate: [
                { path: "category", select: "name" },
                { path: "vendor", select: "name" }
            ]
        });

    // 🔥 Format properly
    const formatted = coupons.map(c => {

        let appliesToResult = [];

        // CASE 1: New schema → appliesTo is ObjectId[] (populated)
        if (Array.isArray(c.appliesTo) && c.appliesTo.length > 0) {
            appliesToResult = c.appliesTo.map(cat => cat?.name).filter(Boolean);
        }

        // CASE 2: Old schema coupons → appliesTo was stored as String
        else if (typeof c.appliesTo === "string" && c.appliesTo.trim() !== "") {
            appliesToResult = [c.appliesTo];
        }

        // CASE 3: Empty → auto derive from products categoryName
        else {
            const categoryNames = [
                ...new Set(
                    c.applicableProducts.map(p => p.category?.name).filter(Boolean)
                )
            ];

            if (categoryNames.length > 0) {
                appliesToResult = categoryNames;
            } else {
                appliesToResult = ["All Products"];
            }
        }

        return {
            id: c._id,
            code: c.code,
            discount: c.discount,
            minimumOrder: c.minimumOrder,
            totalUsageLimit: c.totalUsageLimit,
            usageLimitPerUser: c.usageLimitPerUser,
            status: c.status,
            startDate: c.startDate,
            expiryDate: c.expiryDate,

            // Final clean category names
            appliesTo: appliesToResult,

            vendor: {
                id: c.vendor?._id,
                name: c.vendor?.name,
                profilePicture: c.vendor?.profilePicture
            },

            products: c.applicableProducts.map(p => ({
                id: p._id,
                name: p.name,
                price: p.price,
                image: p.images?.[0] || null,
                categoryName: p.category?.name || "No Category",
                vendorName: p.vendor?.name
            }))
        };
    });

    return res.status(200).json({
        success: true,
        count: formatted.length,
        data: formatted
    });
});







// Update a coupon
const updateVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid coupon ID." });
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({ success: false, message: "Coupon not found." });
    }

    if (coupon.vendor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Not authorized." });
    }

    let {
        code,
        discount,
        appliesTo,
        productIds = [],
        minimumOrder,
        usageLimitPerUser,
        totalUsageLimit,
        startDate,
        expiryDate,
        status
    } = req.body;

    // -------------------------
    // BASIC FIELD UPDATES
    // -------------------------
    if (code) coupon.code = code.toUpperCase();
    if (discount) {
        coupon.discount.value = discount.value ?? coupon.discount.value;
        coupon.discount.type = discount.type ?? coupon.discount.type;
    }

    if (minimumOrder !== undefined) coupon.minimumOrder = minimumOrder;
    if (usageLimitPerUser !== undefined) coupon.usageLimitPerUser = usageLimitPerUser;
    if (totalUsageLimit !== undefined) coupon.totalUsageLimit = totalUsageLimit;
    if (status) coupon.status = status;
    if (startDate) coupon.startDate = new Date(startDate);
    if (expiryDate) coupon.expiryDate = new Date(expiryDate);

    // -------------------------------------------
    // CATEGORY NAME → OBJECT ID
    // -------------------------------------------
    let convertedCategoryIds = [];

    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        const categories = await Category.find({
            $or: [
                { _id: { $in: appliesTo.filter(id => mongoose.Types.ObjectId.isValid(id)) } },
                { name: { $in: appliesTo } }
            ]
        }).select("_id name");

        if (categories.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid category names." });
        }

        convertedCategoryIds = categories.map(c => c._id);
        appliesTo = convertedCategoryIds;
    }

    // -------------------------------------------
    // PRODUCT LOGIC
    // -------------------------------------------
    if (appliesTo !== undefined) {

        let finalApplicable = [];
        let isUniversal = false;

        // UNIVERSAL COUPON
        if (appliesTo === "All Products" || appliesTo === "All Categories") {
            coupon.appliesTo = [];
            coupon.applicableProducts = [];
            isUniversal = true;
        }

        // CATEGORY BASED
        else if (Array.isArray(appliesTo)) {

            if (productIds.length === 0) {
                const products = await Product.find({
                    vendor: req.user._id,
                    category: { $in: appliesTo }
                }).select("_id");

                if (products.length === 0) {
                    return res.status(404).json({ success: false, message: "No products found." });
                }

                finalApplicable = products.map(p => p._id);
            } else {
                const products = await Product.find({
                    _id: { $in: productIds },
                    vendor: req.user._id,
                    category: { $in: appliesTo }
                }).select("_id");

                if (products.length !== productIds.length) {
                    return res.status(403).json({ success: false, message: "Invalid product selection." });
                }

                finalApplicable = products.map(p => p._id);
            }

            coupon.appliesTo = appliesTo;
            coupon.applicableProducts = finalApplicable;
        }

        // SPECIFIC PRODUCT
        else if (appliesTo === "Specific Product") {

            const products = await Product.find({
                _id: { $in: productIds },
                vendor: req.user._id
            }).select("_id");

            if (products.length !== productIds.length) {
                return res.status(403).json({ success: false, message: "Invalid product selection." });
            }

            coupon.appliesTo = [];
            coupon.applicableProducts = products.map(p => p._id);
        }

        else {
            return res.status(400).json({ success: false, message: "Invalid appliesTo." });
        }
    }

    // -------------------------------------------
    // SAVE + POPULATE
    // -------------------------------------------
    let updated = await coupon.save();

    updated = await Coupon.findById(updated._id)
        .populate({ path: "appliesTo", select: "name" })
        .populate({
            path: "applicableProducts",
            select: "name images price category vendor",
            populate: [
                { path: "category", select: "name" },
                { path: "vendor", select: "name" }
            ]
        })
        .populate({ path: "vendor", select: "name profilePicture" });

    // -------------------------------------------
    // CLEAN RESPONSE FORMAT
    // -------------------------------------------
    const response = {
        id: updated._id,
        code: updated.code,
        discount: updated.discount,
        minimumOrder: updated.minimumOrder,
        usageLimitPerUser: updated.usageLimitPerUser,
        totalUsageLimit: updated.totalUsageLimit,
        startDate: updated.startDate,
        expiryDate: updated.expiryDate,
        status: updated.status,

        // 🔥 ALWAYS RETURN PLAIN CATEGORY NAMES
        appliesTo:
            Array.isArray(updated.appliesTo) && updated.appliesTo.length > 0
                ? updated.appliesTo.map(c => c.name)
                : (updated.appliesTo || []),

        vendor: {
            id: updated.vendor?._id,
            name: updated.vendor?.name || "Unknown Vendor",
            profilePicture: updated.vendor?.profilePicture || null
        },

        products: updated.applicableProducts.map(p => ({
            id: p._id,
            name: p.name,
            price: p.price,
            image: p.images?.[0] || null,
            categoryName: p.category?.name || "No Category",
            vendorName: p.vendor?.name || "No Vendor"
        }))
    };

    res.status(200).json({
        success: true,
        message: "Coupon updated successfully.",
        data: response
    });
});







const deleteVendorCoupon = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const vendorId = req.user?._id;

    // 1️⃣ Validate Vendor ID
    if (!vendorId) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized: Vendor not found in request.",
        });
    }

    // 2️⃣ Validate Coupon ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid or missing coupon ID.",
        });
    }

    // 3️⃣ Find Coupon
    const coupon = await Coupon.findById(id);
    if (!coupon) {
        return res.status(404).json({
            success: false,
            message: "Coupon not found.",
        });
    }

    // 4️⃣ Validate Ownership
    if (!coupon.vendor || coupon.vendor.toString() !== vendorId.toString()) {
        return res.status(403).json({
            success: false,
            message: "You are not authorized to delete this coupon.",
        });
    }

    const deletedCode = coupon.code;

    // 5️⃣ Delete Coupon
    await Coupon.findByIdAndDelete(id);

    // 6️⃣ --------------------------------------------
    // 🔔 SEND NOTIFICATIONS (Admin + Vendor)
    // -----------------------------------------------
    try {
        // 🔥 Notify Admin (Push Enabled)
        await createAndSendNotification(
            req,
            "Coupon Deleted",
            `Vendor ${req.user.name || "A vendor"} deleted coupon "${deletedCode}".`,
            {
                couponId: id,
                code: deletedCode,
                vendorId,
            },
            "Admin",
            null,
            { disablePush: false }
        );

        // 🔥 Notify Vendor (Bell Only, No Push)
        await createAndSendNotification(
            req,
            "Coupon Deleted Successfully 🗑️",
            `Your coupon "${deletedCode}" has been deleted successfully.`,
            {
                couponId: id,
                code: deletedCode,
            },
            "Vendor",
            vendorId,
            { disablePush: true }
        );

        // OPTIONAL → Notify Buyers (if needed)
        /*
        await createAndSendNotification(
            req,
            "Coupon Removed 🗑️",
            `Coupon "${deletedCode}" is no longer available.`,
            {
                couponId: id,
                code: deletedCode,
            },
            "Buyer",
            null,
            { disablePush: false }
        );
        */
    } catch (error) {
        console.error("❌ Notification sending failed:", error);
    }

    // 7️⃣ Final Response
    return res.status(200).json({
        success: true,
        message: `Coupon "${deletedCode}" deleted successfully.`,
        data: { couponId: id, code: deletedCode },
    });
});





const getUserProfile = asyncHandler(async (req, res) => {
  console.log("🟦 GET USER PROFILE API HIT");

  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const vendorDetails = user.vendorDetails || {};

    // BASE RESPONSE
    const responseData = {
      id: user._id,
      name: user.name,
      mobileNumber: user.mobileNumber,
      profilePicture: user.profilePicture,   // ✅ FIXED
      role: user.role,
      upiId: user.upiId,
      address: user.address,
      language: user.language,
      about: vendorDetails.about || "",
      status: user.status,
      farmImages: vendorDetails.farmImages || []
    };

    // VENDOR DATA (RATING + REVIEWS)
    if (user.role === "Vendor") {
      responseData.totalOrders = vendorDetails.totalOrders || 0;
      responseData.deliveryRegion = vendorDetails.deliveryRegion || 5;

      const vendorProducts = await Product.find({ vendor: user._id }).select("_id");
      const productIds = vendorProducts.map((p) => p._id);

      if (productIds.length === 0) {
        responseData.rating = 5;
        responseData.totalReviews = 0;
        responseData.reviews = { count: 0, list: [] };
        return res.status(200).json({ success: true, user: responseData });
      }

      const reviewDocs = await Review.find({ product: { $in: productIds } })
        .populate("user", "name profilePicture")
        .sort({ createdAt: -1 })
        .limit(5);

      const reviews = reviewDocs.map((r) => ({
        _id: r._id,
        user: r.user,
        rating: r.rating,
        comment: r.comment || "",
        images: r.images,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      const reviewCount = await Review.countDocuments({ product: { $in: productIds } });

      const ratingAgg = await Review.aggregate([
        { $match: { product: { $in: productIds } } },
        { $group: { _id: null, avgRating: { $avg: "$rating" } } },
      ]);

      let avgRating = ratingAgg[0]?.avgRating || 0;
      let finalRating = parseFloat(avgRating.toFixed(1));
      if (!finalRating || isNaN(finalRating)) finalRating = 5;

      await User.findByIdAndUpdate(user._id, { rating: finalRating });

      responseData.rating = finalRating;
      responseData.totalReviews = reviewCount;
      responseData.reviews = { count: reviewCount, list: reviews };
    }

    // BUYER DATA
    if (user.role === "Buyer") {
      responseData.totalOrdersAsBuyer = user.totalOrdersAsBuyer || 0;
    }

    return res.status(200).json({ success: true, user: responseData });

  } catch (error) {
    console.log("❌ Get Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});










const updateUserProfile = asyncHandler(async (req, res) => {
  console.log("🟦 UPDATE PROFILE API HIT");
  console.log("📥 Body:", req.body);
  console.log("📸 Files:", req.files);

  try {
    const { name, mobileNumber, upiId, about, status } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (mobileNumber && !/^\d{10}$/.test(mobileNumber)) {
      return res.status(400).json({ success: false, message: "Mobile number must be 10 digits." });
    }

    if (mobileNumber && mobileNumber !== user.mobileNumber) {
      const exists = await User.findOne({ mobileNumber });
      if (exists) return res.status(400).json({ success: false, message: "Mobile number already registered." });
    }

    // PROFILE PICTURE UPLOAD
    if (req.files?.profilePicture?.[0]) {
      try {
        if (user.profilePicture) {
          const publicId = user.profilePicture.split("/").pop().split(".")[0];
          await cloudinaryDestroy(`profile-images/${publicId}`);
        }

        const uploaded = await cloudinaryUpload(
          req.files.profilePicture[0].path,
          "profile-images"
        );

        user.profilePicture = uploaded.secure_url;  // ✅ FIXED
      } catch (err) {
        return res.status(500).json({ success: false, message: "Profile image upload failed" });
      }
    }

    // FARM IMAGES
    if (req.files?.farmImages?.length > 0) {
      user.vendorDetails = user.vendorDetails || {};

      if (Array.isArray(user.vendorDetails.farmImages)) {
        for (const imgUrl of user.vendorDetails.farmImages) {
          const publicId = imgUrl.split("/").pop().split(".")[0];
          await cloudinaryDestroy(`farm-images/${publicId}`);
        }
      }

      const urls = [];
      for (const file of req.files.farmImages) {
        const up = await cloudinaryUpload(file.path, "farm-images");
        urls.push(up.secure_url);
      }

      user.vendorDetails.farmImages = urls;
    }

    if (name) user.name = name;
    if (mobileNumber) user.mobileNumber = mobileNumber;
    if (upiId) user.upiId = upiId;

    if (about) {
      user.vendorDetails = user.vendorDetails || {};
      user.vendorDetails.about = about;
    }

    if (req.body.address) {
      try {
        user.address = typeof req.body.address === "string"
          ? JSON.parse(req.body.address)
          : req.body.address;
      } catch {
        return res.status(400).json({ success: false, message: "Invalid address JSON format" });
      }
    }

    if (status) {
      if (!["Active", "Inactive"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      user.status = status;
    }

    const updatedUser = await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: updatedUser._id,
        name: updatedUser.name,
        mobileNumber: updatedUser.mobileNumber,
        upiId: updatedUser.upiId,
        profilePicture: updatedUser.profilePicture,  // ✅ FIXED
        farmImages: updatedUser.vendorDetails?.farmImages || [],
        address: updatedUser.address,
        about: updatedUser.vendorDetails?.about || "",
        status: updatedUser.status,
      },
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});









const uploadProfileImage = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No image file uploaded.",
    });
  }

  try {
    // 1️⃣ Delete old profile image if exists
    if (user.profilePicture) {
      const oldPublicId = user.profilePicture.split("/").pop().split(".")[0];
      await cloudinaryDestroy(`profile-images/${oldPublicId}`);
    }

    // 2️⃣ Upload new image using helper
    const uploaded = await cloudinaryUpload(req.file.path, "profile-images");

    // 3️⃣ Update user record
    user.profilePicture = uploaded.secure_url;
    user.profilePictureId = uploaded.public_id; // ⭐ Now you know public_id
    await user.save();

    // 4️⃣ Personal notification (Vendor or Buyer)
    await createAndSendNotification(
      req,
      "Profile Picture Updated",
      "Your profile picture has been updated successfully.",
      {
        userId: user._id,
        profileUrl: uploaded.secure_url,
      },
      user.role, // "Vendor" or "Buyer"
      user._id
    );

    // 5️⃣ Response
    return res.status(200).json({
      success: true,
      message: "Profile image updated successfully.",
      imageUrl: uploaded.secure_url,
    });
  } catch (err) {
    console.error("🔥 Profile upload error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to upload profile image.",
    });
  }
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
  try {
    let {
      pinCode,
      houseNumber,
      locality,
      city,
      district,
      latitude,
      longitude,
      deliveryRegion
    } = req.body;

    /* ===============================
       1️⃣ DELIVERY REGION
    =============================== */
    const userUpdate = {};
    if (deliveryRegion !== undefined) {
      const region = parseFloat(deliveryRegion);
      if (isNaN(region) || region <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Delivery region must be a positive number.'
        });
      }
      userUpdate['vendorDetails.deliveryRegion'] = region;
    }

    /* ===============================
       2️⃣ ADDRESS UPSERT
    =============================== */
    let addressUpdate = {};
    let locationPoint = null;

    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid latitude or longitude values.'
        });
      }

      locationPoint = { type: 'Point', coordinates: [lng, lat] };
    }

    if (pinCode) addressUpdate.pinCode = pinCode;
    if (houseNumber) addressUpdate.houseNumber = houseNumber;
    if (locality) addressUpdate.locality = locality;
    if (city) addressUpdate.city = city;
    if (district) addressUpdate.district = district;
    if (locationPoint) addressUpdate.location = locationPoint;

    if (
      Object.keys(userUpdate).length === 0 &&
      Object.keys(addressUpdate).length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided for update.'
      });
    }

    /* ===============================
       3️⃣ UPDATE / CREATE ADDRESS
    =============================== */
    let address = await Address.findOne({
      user: req.user._id,
      isDefault: true
    });

    if (!address) {
      address = await Address.create({
        user: req.user._id,
        isDefault: true,
        ...addressUpdate
      });
    } else if (Object.keys(addressUpdate).length) {
      Object.assign(address, addressUpdate);
      await address.save();
    }

    /* ===============================
       4️⃣ UPDATE USER (LOCATION + REGION)
    =============================== */
    if (locationPoint) userUpdate.location = locationPoint;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: userUpdate },
      { new: true }
    );

    /* ===============================
       5️⃣ RESPONSE (UNCHANGED)
    =============================== */
    res.status(200).json({
      success: true,
      message: 'Location and delivery details updated successfully.',
      data: {
        address: address || null,
        location: updatedUser.location || null,
        deliveryRegion: updatedUser.vendorDetails?.deliveryRegion
          ? `${updatedUser.vendorDetails.deliveryRegion} km`
          : null
      }
    });
  } catch (error) {
    console.error('❌ Error updating vendor location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating location details.',
      error: error.message
    });
  }
});



const getLocationDetails = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('location vendorDetails role');

    if (!user || user.role !== 'Vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can access location details.'
      });
    }

    const address =
      await Address.findOne({ user: req.user._id, isDefault: true }).lean() ||
      await Address.findOne({ user: req.user._id }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      success: true,
      data: {
        address: address || null,
        location: user.location || null,
        deliveryRegion: user.vendorDetails?.deliveryRegion ?? null
      }
    });
  } catch (error) {
    console.error('❌ Error fetching location details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching location details.',
      error: error.message
    });
  }
});





const getVendorLocationDetails = asyncHandler(async (req, res) => {
  if (req.user.role !== 'Vendor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Must be a vendor.'
    });
  }

  const vendor = await User.findById(req.user._id)
    .select('location vendorDetails');

  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor profile not found.'
    });
  }

  const address =
    await Address.findOne({ user: req.user._id, isDefault: true }).lean() ||
    await Address.findOne({ user: req.user._id }).sort({ createdAt: -1 }).lean();

  res.status(200).json({
    success: true,
    data: {
      address: address || null,
      location: vendor.location || null,
      deliveryRegion: vendor.vendorDetails?.deliveryRegion
        ? `${vendor.vendorDetails.deliveryRegion} km`
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
    getProductById, getVendorLocationDetails,getLocationDetails,
    changePassword, getVendorProductsByCategory,
    logout,
    uploadProfileImage,
    updateLocationDetails,
    updateUserLanguage,
    updateOrderStatus,
    getMonthlyOrders,
    getRecentVendorOrders, getTodaysOrders, getVendorDashboardAnalytics, getVendorOrderStats
};

