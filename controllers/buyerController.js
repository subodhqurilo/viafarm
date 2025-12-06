// controllers/buyerController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Variety = require('../models/Variety');
const DeliveryPreference = require("../models/DeliveryPreference");


const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const Wishlist = require('../models/Wishlist');
const Address = require('../models/Address');
const Review = require('../models/Review');
const { cloudinaryUpload, cloudinaryDestroy,upload } = require("../services/cloudinaryService");

const Coupon = require('../models/Coupon');
const { calculateOrderSummary, getDeliveryCharge } = require('../utils/orderUtils');
const Donation = require('../models/Donation');
const QRCode = require('qrcode');
const PickupLocation = require('../models/PickupLocation');
const Notification = require("../models/Notification");
const { addressToCoords, coordsToAddress } = require('../utils/geocode');
const axios = require('axios');
const { getDistanceKm } = require("../utils/orderUtils"); // ✅ import Haversine function
const NotificationSettings = require('../models/NotificationSettings');
const Category = require("../models/Category");
const Product = require("../models/Product");   // ✅ Product also imported

const { createAndSendNotification } = require('../utils/notificationUtils');
const { Expo } = require("expo-server-sdk");

const expo = new Expo();


 async function geocodeAddress({ houseNumber, street, locality, city, district, state, pinCode }) {
  try {
    const fullAddress = [houseNumber, street, locality, city, district, state, pinCode]
      .filter(Boolean)
      .join(", ");

    if (!fullAddress) return null;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&limit=1`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "ViaFarm/1.0 (viafarm.app)" },
    });

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (!isNaN(lat) && !isNaN(lon)) return [lon, lat];
    }
    return null;
  } catch (err) {
    console.warn("⚠️ Geocoding failed:", err.message);
    return null;
  }
}
// --- Helper: Calculate distance between two coordinates (in km) ---
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
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
/**
 * --- Estimate Delivery Date ---
 * 🟢 Within vendor region: same/next day (after 5 PM → next day)
 * 🟡 Same state but out of region: +2 days
 * 🔴 Different state: +3 days
 */
const calculateEstimatedDelivery = (vendor, buyer, orderTime = new Date()) => {
  let deliveryDate = new Date(orderTime);

  const vendorCoords = vendor?.location?.coordinates || [0, 0];
  const buyerCoords = buyer?.location?.coordinates || [0, 0];
  const vendorLat = vendorCoords[1];
  const vendorLng = vendorCoords[0];
  const buyerLat = buyerCoords[1];
  const buyerLng = buyerCoords[0];

  const distanceKm = calculateDistanceKm(vendorLat, vendorLng, buyerLat, buyerLng);

  const normalize = (s) => s?.trim()?.toLowerCase().replace(/\s+/g, "");
  const vendorState = normalize(vendor?.address?.state);
  const buyerState = normalize(buyer?.address?.state);

  let deliveryDays = 0;

  if (distanceKm <= (vendor?.vendorDetails?.deliveryRegion || vendor?.deliveryRegion || 0)) {
    const cutoffHour = 17;
    if (orderTime.getHours() >= cutoffHour) {
      deliveryDays = 1; // after 5PM → next day
    }
  } else if (vendorState && buyerState && vendorState === buyerState) {
    deliveryDays = 2; // same state
  } else {
    deliveryDays = 3; // different state
  }

  deliveryDate.setDate(deliveryDate.getDate() + deliveryDays);

  // ✅ Format: "Nov 10 2025"
  const options = { month: "short", day: "2-digit", year: "numeric" };
  const formattedDate = deliveryDate.toLocaleDateString("en-US", options).replace(",", "");

  return {
    formatted: formattedDate, // "Nov 10 2025"
    deliveryText: `Delivery by ${formattedDate}`,
  };
};






function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
const formatCategories = async (vendorId) => {
  try {
    if (!vendorId) return 'No vendor ID';

    // Get all unique product categories for this vendor
    const categories = await Product.distinct('category', { vendor: vendorId });

    if (!categories || categories.length === 0) return 'No categories listed';

    // Capitalize first letter for nice display
    const formatted = categories.map(
      (c) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
    );

    // Show only first 2, rest summarized
    const displayCategories = formatted.slice(0, 2);
    const extraCount = formatted.length - 2;

    return extraCount > 0
      ? `${displayCategories.join(', ')}, (+${extraCount})`
      : displayCategories.join(', ');
  } catch (err) {
    console.error('formatCategories error:', err.message);
    return 'No categories listed';
  }
};





const formatDeliveryDate = (date) => {
    // ... (implementation for formatting delivery date)
    if (!date) return 'N/A';
    const deliveryDate = new Date(date);
    deliveryDate.setDate(deliveryDate.getDate() + 3);
    const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    const formattedDate = deliveryDate.toLocaleDateString('en-US', options);
    const [weekday, month, day, year] = formattedDate.split(/[\s,]+/);
    return `${weekday}, ${day} ${month} ${year}`;
};

const generateUpiPaymentUrl = (upiId, name, amount, transactionId) => {
    const payeeVpa = encodeURIComponent(upiId);
    const payeeName = encodeURIComponent(name);
    const transactionNote = encodeURIComponent(`Payment for Orders: ${transactionId}`);
    const encodedAmount = encodeURIComponent(amount.toFixed(2));
    return `upi://pay?pa=${payeeVpa}&pn=${payeeName}&am=${encodedAmount}&tn=${transactionNote}&tr=${transactionId}&cu=INR`;
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
  const { search, category, vendor, minPrice, maxPrice, status } = req.query;

  const filter = {};

  // ⭐ CATEGORY FILTER — ID or NAME
  if (category) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(category);

    if (isObjectId) {
      filter.category = category;
    } else {
      const categoryDoc = await Category.findOne({
        name: { $regex: category, $options: "i" },
      });

      if (!categoryDoc) {
        return res.status(200).json({ success: true, data: [] });
      }

      filter.category = categoryDoc._id;
    }
  }

  // ⭐ VENDOR FILTER — ID or NAME
  if (vendor) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(vendor);

    if (isObjectId) {
      filter.vendor = vendor;
    } else {
      const vendorDoc = await Vendor.findOne({
        name: { $regex: vendor, $options: "i" },
      });

      if (!vendorDoc) {
        return res.status(200).json({ success: true, data: [] });
      }

      filter.vendor = vendorDoc._id;
    }
  }

  // ⭐ STATUS FILTER
  if (status) filter.status = status;

  // ⭐ PRICE FILTER
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  // ⭐ COMPLETE SEARCH ENGINE
  let searchQuery = {};

  if (search) {
    searchQuery = {
      $or: [
        { name: { $regex: search, $options: "i" } },          // product name
        { variety: { $regex: search, $options: "i" } },       // variety
        { "category.name": { $regex: search, $options: "i" } }, // category name
        { "vendor.name": { $regex: search, $options: "i" } },   // vendor name
      ],
    };
  }

  // ⭐ MAIN QUERY
  const products = await Product.find(filter)
    .populate("vendor", "name mobileNumber")
    .populate("category", "name")
    .find(searchQuery)
    .sort({ createdAt: -1 })
    .lean();

  // ⭐ FORMAT OUTPUT
  const formatted = products.map((item) => ({
    ...item,
    category: item.category?.name || "",
    vendorName: item.vendor?.name || "",
  }));

  return res.json({
    success: true,
    data: formatted,
  });
});





const getProductDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let { buyerLat, buyerLng } = req.query;

  // Validate product ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID.",
    });
  }

  // Fetch main product with vendor + category
  const product = await Product.findById(id)
    .populate("vendor", "name address mobileNumber rating location profilePicture vendorDetails")
    .populate("category", "name image");

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  // Keep only category name
  const categoryName = product.category?.name || null;

  // ----------------------------
  // DISTANCE CALCULATION
  // ----------------------------
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    return (
      2 *
      Math.atan2(
        Math.sqrt(
          Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
              Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2
        ),
        Math.sqrt(
          1 -
            (Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) ** 2)
        )
      ) * R
    );
  };

  let buyerHasLocation = false;

  // If buyer location missing, try fetching from user profile
  if ((!buyerLat || !buyerLng) && req.user?._id) {
    const buyer = await User.findById(req.user._id).select("location");
    if (buyer?.location?.coordinates?.length === 2) {
      buyerLng = buyer.location.coordinates[0];
      buyerLat = buyer.location.coordinates[1];
      buyerHasLocation = true;
    }
  } else if (buyerLat && buyerLng) {
    buyerHasLocation = true;
  }

  let distanceText = "Please update your delivery address to view distance.";

  if (buyerHasLocation && product.vendor?.location?.coordinates?.length === 2) {
    const [vendorLng, vendorLat] = product.vendor.location.coordinates;
    const distance = getDistanceKm(
      parseFloat(buyerLat),
      parseFloat(buyerLng),
      vendorLat,
      vendorLng
    );
    distanceText = `${distance.toFixed(2)} km away`;
  }

  // ----------------------------
  // RECOMMENDED PRODUCTS
  // ----------------------------

  const recQuery = {
    _id: { $ne: product._id },
    status: "In Stock",
    $or: [{ vendor: product.vendor?._id }],
  };

  if (product.category?._id) {
    recQuery.$or.push({ category: product.category._id });
  }

  const recommendedProducts = await Product.find(recQuery)
    .populate("category", "name")
    .populate("vendor", "name profilePicture") // ⭐ vendor name added
    .sort({ rating: -1, createdAt: -1 })
    .limit(6)
    .select(
      "name category vendor price unit quantity images rating status allIndiaDelivery"
    );

  // ----------------------------
  // FINAL RESPONSE
  // ----------------------------

  res.status(200).json({
    success: true,
    data: {
      product: {
        _id: product._id,
        name: product.name,
        category: categoryName,
        variety: product.variety,
        price: product.price,
        quantity: product.quantity,
        unit: product.unit,
        description: product.description,
        weightPerPiece: product.weightPerPiece,
        images: product.images,
        status: product.status,
        allIndiaDelivery: product.allIndiaDelivery,
        rating: product.rating,
        ratingCount: product.ratingCount,
        nutritionalValue: product.nutritionalValue || {},
        datePosted: product.datePosted,
      },

      vendor: {
        id: product.vendor._id,
        name: product.vendor.name,
        mobileNumber: product.vendor.mobileNumber,
        profilePicture: product.vendor.profilePicture,
        rating: product.vendor.rating || 0,
        distance: distanceText,
        address: product.vendor.address,
        location: product.vendor.location,
        deliveryRegion: product.vendor.vendorDetails?.deliveryRegion || null,
        about: product.vendor.vendorDetails?.about || "",
      },

      reviews: {
        totalCount: 0,
        list: [],
      },

      recommendedProducts,
    },
  });
});



const getCategoriesWithProducts = asyncHandler(async (req, res) => {
  try {
    // 🔹 Buyer location for distance calculation
    const buyer = await User.findById(req.user._id).select("location");
    const buyerLocation = buyer?.location?.coordinates;

    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
      const toRad = (v) => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // 1️⃣ Get all categories
    const categories = await Category.find({}).sort({ name: 1 });

    // 2️⃣ Get all in-stock products + populate
    const products = await Product.find({ status: "In Stock" })
      .populate("category", "name") // Only category name
      .populate("vendor", "name location") // vendor with location
      .sort({ createdAt: -1 });

    // 3️⃣ Process products for consistent format
    const formattedProducts = products.map((p) => {
      let distanceText = "N/A";

      if (p.vendor?.location?.coordinates && buyerLocation) {
        const [vendorLng, vendorLat] = p.vendor.location.coordinates;
        const [buyerLng, buyerLat] = buyerLocation;
        const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
        distanceText = `${distance.toFixed(2)} km away`;
      }

      const obj = p.toObject();

      // Replace category with its name only
      obj.category = obj.category?.name || null;

      // Add distance property
      obj.distance = distanceText;

      return obj;
    });

    // 4️⃣ Group products by category
    const result = categories.map((cat) => {
      const matchedProducts = formattedProducts.filter(
        (p) => p.category === cat.name
      );

      return {
        _id: cat._id,
        name: cat.name,
        image: cat.image,
        productCount: matchedProducts.length,
        products: matchedProducts,
      };
    });

    res.status(200).json({
      success: true,
      totalCategories: result.length,
      data: result,
    });

  } catch (error) {
    console.error("❌ Error fetching categories with products:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching categories and products.",
      error: error.message,
    });
  }
});


const getFreshAndPopularProducts = asyncHandler(async (req, res) => {
    const buyer = await User.findById(req.user._id).select('location');

    // 📏 Helper inside controller for clarity
    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371; // km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const products = await Product.find({ status: "In Stock" })
        .populate("vendor", "name location")
        .populate("category", "name")   // ✅ Add category name
        .sort({ rating: -1, createdAt: -1 })
        .limit(10);

    const enriched = products.map((p) => {
        let distanceText = "N/A";

        if (p.vendor?.location?.coordinates && buyer?.location?.coordinates) {
            const [vendorLng, vendorLat] = p.vendor.location.coordinates;
            const [buyerLng, buyerLat] = buyer.location.coordinates;

            const distance = getDistanceKm(
                buyerLat,
                buyerLng,
                vendorLat,
                vendorLng
            );

            if (!isNaN(distance)) {
                distanceText = `${distance.toFixed(2)} km away`;
            }
        }

        const obj = p.toObject();

        // ✅ convert category object → category name only
        obj.category = obj.category?.name || null;

        return {
            ...obj,
            distance: distanceText,
        };
    });

    res.status(200).json({
        success: true,
        count: enriched.length,
        data: enriched,
    });
});

const getFreshAndPopularVendors = asyncHandler(async (req, res) => {
    const buyerId = req.user._id;

    // 🧭 1️⃣ Fetch buyer location
    const buyer = await User.findById(buyerId).select("location");
    if (!buyer || !buyer.location?.coordinates?.length) {
        return res.status(400).json({
            success: false,
            message: "Buyer location not found. Please update your address.",
        });
    }

    const [buyerLng, buyerLat] = buyer.location.coordinates;

    // 📏 Distance helper
    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // 🟢 2️⃣ Get ALL Fresh + Popular products
    const products = await Product.find({ status: "In Stock" })
        .populate("vendor", "name profilePicture location vendorDetails")
        .populate("category", "name")
        .sort({ rating: -1, createdAt: -1 })
        .limit(100); // fetch more, we will filter later

    if (!products.length) {
        return res.status(404).json({
            success: false,
            message: "No fresh or popular products found.",
        });
    }

    // 🟢 3️⃣ Group products by vendor
    const mapVendor = {};

    for (const p of products) {
        if (!p.vendor) continue;
        const vId = p.vendor._id.toString();

        if (!mapVendor[vId]) {
            // initialize vendor
            mapVendor[vId] = {
                id: vId,
                name: p.vendor.name,
                profilePicture:
                    p.vendor.profilePicture ||
                    "https://res.cloudinary.com/demo/image/upload/v1679879879/default_vendor.png",
                distance: "N/A",
                distanceValue: 9999,
                categories: new Set(),
                topProducts: [],
            };

            // calculate distance once per vendor
            if (p.vendor.location?.coordinates?.length === 2) {
                const [vLng, vLat] = p.vendor.location.coordinates;
                const dist = getDistanceKm(
                    buyerLat,
                    buyerLng,
                    vLat,
                    vLng
                );

                mapVendor[vId].distance = `${dist.toFixed(2)} km away`;
                mapVendor[vId].distanceValue = parseFloat(dist.toFixed(2));
            }
        }

        // add category
        if (p.category?.name) {
            mapVendor[vId].categories.add(p.category.name);
        }

        // add product to top list
        mapVendor[vId].topProducts.push({
            id: p._id,
            name: p.name,
            price: p.price,
            unit: p.unit,
            rating: p.rating,
            image: p.images?.[0] || null,
            category: p.category?.name || null,
        });
    }

    // 🟢 4️⃣ Convert map -> array
    let vendors = Object.values(mapVendor);

    // limit top 5 fresh/popular products per vendor
    vendors = vendors.map((v) => ({
        ...v,
        categories: [...v.categories], // Set → array
        topProducts: v.topProducts.slice(0, 5),
    }));

    // 🟢 5️⃣ Sort by distance (nearest vendor first)
    vendors.sort((a, b) => a.distanceValue - b.distanceValue);

    // 🟢 6️⃣ Response
    return res.status(200).json({
        success: true,
        count: vendors.length,
        vendors,
    });
});


function DistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


const getLocalBestProducts = asyncHandler(async (req, res) => {
  try {
    // ✅ 1️⃣ Get buyer ID from logged-in user
    const buyerId = req.user?._id;

    if (!buyerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Buyer not logged in.",
      });
    }

    // ✅ 2️⃣ Fetch buyer’s default address (must contain lat/lng)
    const buyerAddress = await Address.findOne({ user: buyerId, isDefault: true }).lean();
    if (
      !buyerAddress?.location?.coordinates ||
      buyerAddress.location.coordinates.length !== 2
    ) {
      return res.status(400).json({
        success: false,
        message: "Buyer location not found. Please set a default address.",
      });
    }

    const [buyerLng, buyerLat] = buyerAddress.location.coordinates.map(Number);
    console.log("📍 Buyer Coordinates:", buyerLat, buyerLng);

    // ✅ 3️⃣ Fetch all active vendors
    const vendors = await User.find({ role: "Vendor", status: "Active" }).select(
      "name profilePicture location vendorDetails"
    );

    // ✅ 4️⃣ Compute vendor distances
    const vendorDistanceMap = {};
    const vendorIds = [];

    for (const v of vendors) {
      if (v.location?.coordinates?.length === 2) {
        const [vendorLng, vendorLat] = v.location.coordinates.map(Number);
        const distanceKm = DistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);

        vendorDistanceMap[v._id.toString()] = {
          distanceKm,
          profilePicture:
            v.profilePicture ||
            "https://res.cloudinary.com/demo/image/upload/v1679879879/default_vendor.png",
        };

        vendorIds.push(v._id);
      }
    }

    // ✅ 5️⃣ Fetch in-stock products from all active vendors
    const products = await Product.find({
      vendor: { $in: vendorIds },
      status: "In Stock",
    })
      .sort({ rating: -1, createdAt: -1 })
      .limit(100)
      .select("name images vendor price unit rating quantity weightPerPiece")
      .populate("vendor", "name status profilePicture location");

    // ✅ 6️⃣ Format response with vendor distance + image
    const formattedProducts = products
      .filter((p) => p.vendor?.status === "Active")
      .map((p) => {
        const vendorId = p.vendor?._id?.toString();
        const vendorData = vendorDistanceMap[vendorId] || {};
        const distanceKm = vendorData.distanceKm ?? null;

        return {
          _id: p._id,
          name: p.name,
          image: p.images?.[0] || null,
          vendorName: p.vendor?.name || "Unknown Vendor",
          vendorImage:
            vendorData.profilePicture ||
            p.vendor?.profilePicture ||
            "https://res.cloudinary.com/demo/image/upload/v1679879879/default_vendor.png",
          distance: distanceKm ? `${distanceKm.toFixed(2)} km away` : "N/A",
          price: p.price,
          rating: p.rating,
          unit: p.unit,
          quantity: p.quantity,
          weightPerPiece: p.weightPerPiece
        };
      });

    // ✅ 7️⃣ Send Response
    return res.status(200).json({
      success: true,
      buyerLocation: { lat: buyerLat, lng: buyerLng },
      count: formattedProducts.length,
      data: formattedProducts,
    });
  } catch (error) {
    console.error("❌ getLocalBestProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching local best products.",
      error: error.message,
    });
  }
});


const getAllAroundIndiaProducts = asyncHandler(async (req, res) => {
    // 🧭 Step 1: Fetch buyer location
    const buyer = await User.findById(req.user._id).select("location");

    if (!buyer || !buyer.location?.coordinates) {
        return res.status(400).json({
            success: false,
            message: "Buyer location not found. Please update your profile location first.",
        });
    }

    const [buyerLng, buyerLat] = buyer.location.coordinates;

    // 📏 Helper: Haversine formula (distance in km)
    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // 🟢 Step 2: Active vendors
    const activeVendorIds = (
        await User.find({ role: "Vendor", status: "Active" }).select("_id")
    ).map((v) => v._id);

    // 🟢 Step 3: Find All India delivery products
    const products = await Product.find({
        status: "In Stock",
        allIndiaDelivery: true,
        vendor: { $in: activeVendorIds },
    })
        .sort({ rating: -1, salesCount: -1 })
        .populate("vendor", "name location status");

    if (!products.length) {
        return res.status(404).json({
            success: false,
            message: "No All-India delivery products found.",
        });
    }

    // 🧮 Step 4: Enrich with distance
    const enrichedProducts = products.map((p) => {
        let distanceText = "N/A";

        if (Array.isArray(p.vendor?.location?.coordinates)) {
            const [vendorLng, vendorLat] = p.vendor.location.coordinates;
            if (vendorLng && vendorLat) {
                const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
                distanceText = `${distance.toFixed(2)} km away`;
            }
        }

        return {
            _id: p._id,
            name: p.name,
            category: p.category,
            image: p.images?.[0] || null,
            vendorName: p.vendor?.name || "Unknown Vendor",
            distance: distanceText,
            price: p.price,
            rating: p.rating,
            unit: p.unit,
            quantity: p.quantity,
            weightPerPiece: p.weightPerPiece,
            allIndiaDelivery: p.allIndiaDelivery,
        };
    });

    // 🧠 Step 5: Sort by nearest (optional UX improvement)
    const sortedProducts = enrichedProducts.sort((a, b) => {
        const da = parseFloat(a.distance);
        const db = parseFloat(b.distance);
        if (isNaN(da)) return 1;
        if (isNaN(db)) return -1;
        return da - db;
    });

    // ✅ Step 6: Response
    res.status(200).json({
        success: true,
        message: "All-India delivery products fetched successfully.",
        count: sortedProducts.length,
        data: sortedProducts,
    });
});

const getSmartPicks = asyncHandler(async (req, res) => {
    const { category } = req.query;
    const userId = req.user._id;

    // 🧭 Step 1: Fetch buyer location
    const buyer = await User.findById(userId).select("location");
    if (!buyer?.location?.coordinates?.length) {
        return res.status(400).json({
            success: false,
            message: "User location not found. Please set your delivery address.",
        });
    }

    // Correct order: [longitude, latitude]
    const [buyerLng, buyerLat] = buyer.location.coordinates;

    // 📏 Distance function
    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // 🟢 Step 2: Active Vendors
    const activeVendorIds = (
        await User.find({ role: "Vendor", status: "Active" }).select("_id")
    ).map((v) => v._id);

    // 🟢 Step 3: Filter
    const filter = {
        status: "In Stock",
        vendor: { $in: activeVendorIds },
    };
    if (category) filter.category = category;

    // 🟢 Step 4: Fetch Products + Category Name
    const products = await Product.find(filter)
        .sort({ rating: -1, createdAt: -1 })
        .limit(20)
        .populate("vendor", "name profilePicture location status")
        .populate("category", "name image"); // ⭐ ADDED

    if (!products.length) {
        return res.status(404).json({
            success: false,
            message: category
                ? `No smart picks found for category: ${category}`
                : "No smart picks found.",
        });
    }

    // 🧮 Step 5: Format Response
    const formatted = products.map((p) => {
        const image = p.images?.[0] || null;
        let distanceText = "N/A";

        if (p.vendor?.location?.coordinates?.length) {
            const [vendorLng, vendorLat] = p.vendor.location.coordinates;
            const dist = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
            distanceText = `${dist.toFixed(2)} km away`;
        }

        return {
            id: p._id,
            name: p.name,
            image,
            price: p.price,
            unit: p.unit,
            rating: p.rating || 0,
            quantity: p.quantity,

            // ⭐ CATEGORY INFO ADDED
            // categoryId: p.category?._id || null,
            category: p.category?.name || null,
            // categoryImage: p.category?.image || null,

            vendorId: p.vendor?._id,
            vendorName: p.vendor?.name || "Unknown Vendor",
            vendorImage: p.vendor?.profilePicture || null,
            distance: distanceText,
        };
    });

    // 🟢 Step 6: Response
    res.status(200).json({
        success: true,
        count: formatted.length,
        data: formatted,
    });
});


const getProductsByCategory = asyncHandler(async (req, res) => {
    const { category } = req.query;

    if (!category) {
        return res.status(400).json({ success: false, message: "Category is required" });
    }

    // Convert category (name OR id) → ObjectId
    let categoryId;

    if (mongoose.isValidObjectId(category)) {
        categoryId = category;
    } else {
        const cat = await Category.findOne({
            name: { $regex: new RegExp(`^${category.trim()}$`, "i") }
        });

        if (!cat) {
            return res.status(404).json({
                success: false,
                message: `Category "${category}" not found.`,
            });
        }

        categoryId = cat._id;
    }

    // Buyer geo
    const buyer = await User.findById(req.user._id).select("location");
    const buyerLocation = buyer?.location?.coordinates;

    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lat2 - lat1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // Active vendors
    const activeVendors = await User.find({
        role: "Vendor",
        status: "Active",
    }).select("_id");

    const activeVendorIds = activeVendors.map((v) => v._id);

    // ⭐ Query products + populate category name
    const products = await Product.find({
        category: categoryId,
        status: "In Stock",
        vendor: { $in: activeVendorIds },
    })
        .populate("category", "name")   // ⭐ Only bring name
        .populate("vendor", "name location")
        .sort({ createdAt: -1, rating: -1 });

    // ⭐ Convert category => category.name
    const enriched = products.map((p) => {
        const obj = p.toObject();

        // Category name only
        obj.category = obj.category?.name || null;

        // Add distance
        if (obj.vendor?.location?.coordinates && buyerLocation) {
            const [vendorLng, vendorLat] = obj.vendor.location.coordinates;
            const [buyerLng, buyerLat] = buyerLocation;

            const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
            obj.distance = `${distance.toFixed(2)} km away`;
        } else {
            obj.distance = "N/A";
        }

        return obj;
    });

    res.status(200).json({
        success: true,
        count: enriched.length,
        data: enriched,
    });
});



const getProductsByVariety = asyncHandler(async (req, res) => {
  const { variety } = req.query;

  // 🧍‍♂️ Step 1: Get buyer's location
  const buyer = await User.findById(req.user._id).select("location");
  const buyerLocation = buyer?.location?.coordinates;

  if (!variety) {
    return res
      .status(400)
      .json({ success: false, message: "Variety is required" });
  }

  // 📏 Helper: Haversine formula (distance in km)
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 🧩 Step 2: Find all active vendors
  const activeVendors = await User.find({ role: "Vendor", status: "Active" }).select("_id");
  const activeVendorIds = activeVendors.map((v) => v._id);

  // 🧩 Step 3: Query products by variety
  const productQuery = {
    variety,
    status: "In Stock",
    vendor: { $in: activeVendorIds },
  };

  // 🟢 Step 4: Fetch products with vendor info
  const products = await Product.find(productQuery)
    .populate("vendor", "name location")
    .sort({ createdAt: -1, rating: -1 });

  // 🧮 Step 5: Enrich with distance
  const enriched = products.map((p) => {
    let distanceText = "N/A";

    if (p.vendor?.location?.coordinates && buyerLocation) {
      const [vendorLng, vendorLat] = p.vendor.location.coordinates;
      const [buyerLng, buyerLat] = buyerLocation;
      const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
      distanceText = `${parseFloat(distance.toFixed(2))} km away`;
    }

    return {
      ...p.toObject(),
      distance: distanceText,
    };
  });

  // ✅ Step 6: Response
  res.status(200).json({
    success: true,
    count: enriched.length,
    data: enriched,
  });
});


const getStaticPageContent = asyncHandler(async (req, res) => {
    const page = await StaticPage.findOne({ pageName: req.params.pageName });
    if (!page) return res.status(404).json({ success: false, message: 'Page not found.' });
    res.status(200).json({ success: true, page });
});

const getVendorsNearYou = asyncHandler(async (req, res) => {
  try {
    const buyerId = req.user?._id;

    if (!buyerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Please log in as a buyer.",
      });
    }

    const buyer = await User.findById(buyerId).select("location");
    const buyerCoords = buyer?.location?.coordinates;

    if (!buyerCoords || buyerCoords.length !== 2) {
      return res.status(400).json({
        success: false,
        message: "Buyer location not found. Please update your address.",
      });
    }

    const [buyerLng, buyerLat] = buyerCoords.map(Number);

    const maxDistanceKm = parseFloat(req.query.maxDistance) || 50;
    const maxDistanceMeters = maxDistanceKm * 1000;

    const vendors = await User.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [buyerLng, buyerLat] },
          distanceField: "distanceMeters",
          spherical: true,
          maxDistance: maxDistanceMeters,
          query: { role: "Vendor", status: "Active" },
        },
      },
      {
        $addFields: {
          distanceKm: { $divide: ["$distanceMeters", 1000] },
        },
      },
      {
        $project: {
          name: 1,
          profilePicture: 1,
          vendorDetails: 1,
          distanceKm: 1,
        },
      },
    ]);

    if (!vendors.length) {
      return res.status(404).json({
        success: false,
        message: `No vendors found within ${maxDistanceKm} km.`,
      });
    }

    // ⭐⭐ FIXED: Fetch vendor categories properly
    const enrichedVendors = await Promise.all(
      vendors.map(async (v) => {
        const products = await Product.find({
          vendor: v._id,
          status: "In Stock"
        })
          .select("category")
          .populate("category", "name");

        // Extract category names
        const categoryNames = [
          ...new Set(
            products
              .map((p) => p.category?.name)
              .filter(Boolean)
          )
        ];

        return {
          id: v._id,
          name: v.name,
          profilePicture:
            v.profilePicture ||
            "https://res.cloudinary.com/demo/image/upload/v1679879879/default_vendor.png",
          distance: `${v.distanceKm.toFixed(1)} km away`,
          distanceValue: parseFloat(v.distanceKm.toFixed(1)),
          categories:
            categoryNames.length ? categoryNames : "No categories listed",
          deliveryRegion: v.vendorDetails?.deliveryRegion || 0,
        };
      })
    );

    enrichedVendors.sort((a, b) => a.distanceValue - b.distanceValue);

    return res.status(200).json({
      success: true,
      count: enrichedVendors.length,
      vendors: enrichedVendors,
      buyerLocation: {
        latitude: buyerLat,
        longitude: buyerLng,
      },
      maxDistanceKm,
    });
  } catch (err) {
    console.error("❌ Error fetching nearby vendors:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearby vendors.",
      error: err.message,
    });
  }
});




const getAllVendors = asyncHandler(async (req, res) => {
  const { q, category } = req.query;
  const userId = req.user._id; 

  try {
    // 1️⃣ Buyer location
    const buyer = await User.findById(userId).select("location");
    const buyerCoords = buyer?.location?.coordinates || [];

    let latitude = buyerCoords[1];
    let longitude = buyerCoords[0];

    // 📌 If buyer has no location → API should NOT crash
    if (!latitude || !longitude) {
      latitude = null;
      longitude = null;
    }

    // 2️⃣ Vendor base query
    let query = { role: "Vendor", status: "Active" };

    // 🔍 Search
    if (q) query.name = { $regex: q, $options: "i" };

    // 🔍 Filter vendors by category
    if (category) {
      const vendorIds = await Product.distinct("vendor", {
        category: { $regex: category, $options: "i" }
      });

      query._id = { $in: vendorIds };
    }

    // 3️⃣ Fetch vendor list
    const vendors = await User.find(query).select(
      "name profilePicture location vendorDetails farmImages address"
    );

    // ⭐ HELPER: GET vendor categories by vendorId
    const getVendorCategories = async (vendorId) => {
      try {
        const products = await Product.find({ vendor: vendorId })
          .populate("category", "name")
          .select("category");

        if (!products.length) return ["No categories listed"];

        const names = products
          .map((p) => p.category?.name)
          .filter(Boolean);

        const unique = [...new Set(names)];

        return unique.length ? unique : ["No categories listed"];
      } catch (err) {
        console.log("formatCategories error:", err.message);
        return ["No categories listed"];
      }
    };

    // 4️⃣ Build final vendor objects
    const enrichedVendors = await Promise.all(
      vendors.map(async (vendor) => {
        let distanceText = "N/A";
        let distanceValue = null;

        if (
          latitude !== null &&
          longitude !== null &&
          vendor.location?.coordinates?.length === 2
        ) {
          const [vendorLng, vendorLat] = vendor.location.coordinates;

          const toRad = (v) => (v * Math.PI) / 180;
          const R = 6371;
          const dLat = toRad(vendorLat - latitude);
          const dLon = toRad(vendorLng - longitude);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(latitude)) *
              Math.cos(toRad(vendorLat)) *
              Math.sin(dLon / 2) ** 2;

          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          distanceValue = +(R * c).toFixed(1);
          distanceText = `${distanceValue} km away`;
        }

        return {
          id: vendor._id.toString(),
          name: vendor.name,
          profilePicture:
            vendor.profilePicture ||
            "https://default-image-url.com/default.png",
          farmImages: vendor.farmImages || [],
          locationText:
            vendor.address?.locality ||
            vendor.address?.city ||
            "Unknown Location",
          distance: distanceText,
          distanceValue: distanceValue || 0,
          categories: await getVendorCategories(vendor._id), // ⭐ ARRAY OF CATEGORY NAMES
        };
      })
    );

    // 5️⃣ Sort by nearest vendors first
    enrichedVendors.sort((a, b) => a.distanceValue - b.distanceValue);

    // 6️⃣ Final response
    res.status(200).json({
      success: true,
      count: enrichedVendors.length,
      vendors: enrichedVendors,
    });

  } catch (err) {
    console.error("Error fetching vendors:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch vendors.",
    });
  }
});





// 🛒 GET CART ITEMS
// GET CART WITHOUT DELIVERY CHARGE
const getCartItems = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;

    const emptySummary = {
      totalMRP: 0,
      couponDiscount: 0,
      deliveryCharge: 0,
      totalAmount: 0,
    };

    // ---------------- FETCH CART ----------------
    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: "items.product",
        select: "name price variety images unit vendor category weightPerPiece",
        populate: [
          { path: "category", select: "name" },
          {
            path: "vendor",
            select:
              "name mobileNumber email upiId address vendorDetails profilePicture location status",
          },
        ],
      })
      .lean();

    if (!cart || !cart.items.length) {
      return res.json({
        success: true,
        data: {
          items: [],
          summary: emptySummary,
          priceDetails: emptySummary,
          couponCode: "",
          similarProducts: [],  // <--- added
        },
      });
    }

    // ---------------- BUYER INFO ----------------
    const buyer = await User.findById(userId)
      .select("address location")
      .lean();

    const validItems = [];
    const categoryIds = new Set();

    for (const i of cart.items) {
      if (!i.product) continue;

      const p = i.product;
      const vendor = p.vendor || {};

      // track category for similar products
      if (p.category?._id) {
        categoryIds.add(p.category._id.toString());
      }

      // ---------------- ESTIMATED DELIVERY ----------------
      const deliveryInfo = calculateEstimatedDelivery(vendor, buyer);

      validItems.push({
        id: p._id,
        name: p.name,
        subtitle: p.variety || "",
        mrp: p.price,
        imageUrl: p.images?.[0] || "https://placehold.co/100x100",
        quantity: i.quantity,
        unit: p.unit || "",
        category: p.category?.name || "",
        deliveryText: deliveryInfo.deliveryText,

        vendor: {
          id: vendor._id,
          name: vendor.name,
          mobileNumber: vendor.mobileNumber,
          email: vendor.email,
          upiId: vendor.upiId,
          about: vendor.vendorDetails?.about,
          location: vendor.vendorDetails?.location,
          deliveryRegion: vendor.vendorDetails?.deliveryRegion,
          totalOrders: vendor.vendorDetails?.totalOrders,
          profilePicture: vendor.profilePicture,
          address: vendor.address || {},
          geoLocation: vendor.location?.coordinates || [0, 0],
          status: vendor.status,
        },
      });
    }

    // ---------------- SUMMARY ----------------
    let totalMRP = 0;

    validItems.forEach((i) => {
      totalMRP += i.mrp * i.quantity;
    });

    let couponDiscount = 0;

    if (cart.couponCode) {
      const coupon = await Coupon.findOne({ code: cart.couponCode }).lean();

      if (coupon) {
        if (coupon.discount.type === "Percentage") {
          couponDiscount = (totalMRP * coupon.discount.value) / 100;
        } else {
          couponDiscount = coupon.discount.value;
        }

        if (couponDiscount > totalMRP) couponDiscount = totalMRP;
      }
    }

    const totalAmount = totalMRP - couponDiscount;

    const summary = {
      totalMRP,
      couponDiscount,
      deliveryCharge: 0,
      totalAmount,
    };

    // ---------------- FIND SIMILAR PRODUCTS (BOTTOM OF RESPONSE) ----------------
    const similarProducts = await Product.find({
      category: { $in: Array.from(categoryIds) },
      _id: { $nin: validItems.map((x) => x.id) },
    })
      .select("name price images unit rating weightPerPiece vendor")
      .limit(12)
      .populate("vendor", "name")
      .lean();

    const formattedSimilar = similarProducts.map((p) => ({
      id: p._id,
      name: p.name,
      price: p.price,
      unit: p.unit,
      imageUrl: p.images?.[0] || "",
      vendor: p.vendor?.name || "",
      rating: p.rating,
      weightPerPiece: p.weightPerPiece,
    }));

    // ---------------- RESPONSE ----------------
    return res.json({
      success: true,
      data: {
        items: validItems,
        summary,
        priceDetails: summary,
        couponCode: cart.couponCode || "",
        similarProducts: formattedSimilar, // <--- ADDED HERE
      },
    });
  } catch (error) {
    console.error("❌ getCartItems error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load cart details.",
    });
  }
});







const setDeliveryType = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { deliveryType, addressId, pickupSlot } = req.body;

  // 1️⃣ Validate delivery type
  if (!["Pickup", "Delivery"].includes(deliveryType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid delivery type. Use 'Pickup' or 'Delivery'."
    });
  }

  let updateData = {
    user: userId,
    deliveryType
  };

  // 2️⃣ If Delivery → MUST have addressId
  if (deliveryType === "Delivery") {
    if (!addressId) {
      return res.status(400).json({
        success: false,
        message: "addressId required for Delivery."
      });
    }

    updateData.addressId = addressId;
    updateData.pickupSlot = null;  // ❌ clear pickup slot if previously saved
  }

  // 3️⃣ If Pickup → MUST have pickupSlot
  if (deliveryType === "Pickup") {
    if (
      !pickupSlot ||
      !pickupSlot.date ||
      !pickupSlot.startTime ||
      !pickupSlot.endTime
    ) {
      return res.status(400).json({
        success: false,
        message: "Pickup slot requires date, startTime & endTime."
      });
    }

    updateData.pickupSlot = pickupSlot;
    updateData.addressId = null; // ❌ clear addressId if previously saved
  }

  // 4️⃣ Save in database (upsert)
  const preference = await DeliveryPreference.findOneAndUpdate(
    { user: userId },
    { $set: updateData },
    { new: true, upsert: true }
  );

  // 5️⃣ Send Response
  res.json({
    success: true,
    message: "Delivery preference saved successfully.",
    data: preference
  });
});


const placePickupOrder = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { pickupSlot, couponCode: inputCoupon, comments, paymentMethod } = req.body;

    // ------------------ 1️⃣ VALIDATE PICKUP SLOT ------------------
    if (!pickupSlot?.date || !pickupSlot?.startTime || !pickupSlot?.endTime) {
      return res.status(400).json({
        success: false,
        message: "Pickup slot must include date, startTime & endTime.",
      });
    }

    // ------------------ 2️⃣ VALIDATE PAYMENT ------------------
    if (!["Cash", "UPI"].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Payment method must be Cash or UPI.",
      });
    }

    const isOnlinePayment = paymentMethod === "UPI";
    const isPaid = !isOnlinePayment;
    const orderStatus = isOnlinePayment ? "In-process" : "Confirmed";

    // ------------------ 3️⃣ FETCH CART ------------------
    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: "items.product",
        select: "name price vendor images unit",
      })
      .lean();

    if (!cart || !cart.items.length) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }

    // ⭐ AUTO APPLY COUPON (CART → INPUT)
    const appliedCouponCode = cart.couponCode || inputCoupon || null;

    const validItems = cart.items.filter(i => i.product);
    if (!validItems.length) {
      return res.status(400).json({
        success: false,
        message: "Cart contains invalid products.",
      });
    }

    // ------------------ 4️⃣ COUPON VALIDATION ------------------
    let coupon = null;

    if (appliedCouponCode) {
      coupon = await Coupon.findOne({
        code: appliedCouponCode.toUpperCase(),
        status: "Active",
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      if (!coupon) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired coupon.",
        });
      }

      const used = coupon.usedBy.find(u => u.user.toString() === userId.toString());

      if (coupon.usageLimitPerUser && used && used.count >= coupon.usageLimitPerUser) {
        return res.status(400).json({
          success: false,
          message: `You already used this coupon ${coupon.usageLimitPerUser} times.`,
        });
      }

      if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit) {
        return res.status(400).json({
          success: false,
          message: "Coupon usage limit finished.",
        });
      }
    }

    // ------------------ 5️⃣ GROUP ITEMS BY VENDOR ------------------
    const itemsByVendor = {};
    validItems.forEach(i => {
      const vendorId = i.product.vendor.toString();
      if (!itemsByVendor[vendorId]) itemsByVendor[vendorId] = [];
      itemsByVendor[vendorId].push(i);
    });

    const createdOrderIds = [];
    const payments = [];
    let totalPay = 0;
    let totalDiscount = 0;

    // ------------------ 6️⃣ PROCESS EACH VENDOR ORDER ------------------
    for (const vendorId in itemsByVendor) {
      const vendorItems = itemsByVendor[vendorId];

      // ⭐ FIX: use updated calculateOrderSummary (same as reviewOrder)
      const { summary } = await calculateOrderSummary(
        { items: vendorItems, user: userId },
        appliedCouponCode,
        "Pickup" // no delivery charge
      );

      const vendor = await User.findById(vendorId).select("name upiId").lean();

      totalPay += summary.totalAmount;
      totalDiscount += summary.discount || 0;

      // ------------------ CREATE ORDER ------------------
      const newOrder = await Order.create({
        orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`,
        buyer: userId,
        vendor: vendorId,
        products: vendorItems.map(i => ({
          product: i.product._id,
          quantity: i.quantity,
          price: i.product.price,
        })),
        totalPrice: summary.totalAmount,
        discount: summary.discount,
        couponCode: appliedCouponCode,
        orderType: "Pickup",
        pickupSlot,
        comments: comments || "",
        paymentMethod,
        isPaid,
        orderStatus,
      });

      createdOrderIds.push(newOrder._id);

      // ------------------ 🔔 SEND NOTIFICATIONS ------------------
      await createAndSendNotification(
        req,
        "📦 New Pickup Order",
        `You received a new pickup order (${newOrder.orderId}).`,
        { orderId: newOrder._id, total: newOrder.totalPrice },
        "Vendor",
        vendorId
      );

      await createAndSendNotification(
        req,
        "🛍️ Pickup Order Placed",
        `Your order (${newOrder.orderId}) has been placed successfully.`,
        { orderId: newOrder._id, amount: summary.totalAmount },
        "Buyer",
        userId
      );

      // ------------------ 💳 UPI QR ------------------
      if (isOnlinePayment && vendor?.upiId) {
        const ref = `TXN-${newOrder.orderId.replace("#", "-")}-${Date.now()}`;
        const upiUrl = `upi://pay?pa=${vendor.upiId}&pn=${vendor.name}&am=${summary.totalAmount}&tn=${newOrder.orderId}&tr=${ref}&cu=INR`;
        const qrCode = await QRCode.toDataURL(upiUrl);

        payments.push({
          orderId: newOrder._id,
          vendorName: vendor.name,
          upiId: vendor.upiId,
          amount: summary.totalAmount,
          qrCode,
          upiUrl,
          comments,
          pickupSlot
        });
      }
    }

    // ------------------ 7️⃣ UPDATE COUPON USAGE ------------------
    if (coupon) {
      coupon.usedCount++;
      const used = coupon.usedBy.find(u => u.user.toString() === userId.toString());

      if (used) used.count++;
      else coupon.usedBy.push({ user: userId, count: 1 });

      if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit)
        coupon.status = "Expired";

      await coupon.save();
    }

    // ------------------ 8️⃣ CLEAR CART ------------------
    await Cart.updateOne(
      { user: userId },
      { $set: { items: [], couponCode: null } }
    );

    // ------------------ 9️⃣ FINAL RESPONSE ------------------
    return res.json({
      success: true,
      message: isOnlinePayment
        ? "Orders created. Complete UPI payment to confirm."
        : "Pickup order confirmed (Cash).",
      orderIds: createdOrderIds,
      amountToPay: totalPay,
      discount: totalDiscount,
      paymentMethod,
      payments,
      pickupSlot
    });

  } catch (error) {
    console.error("Pickup Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to place order",
      error: error.message
    });
  }
});



const placeOrder = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { comments, paymentMethod } = req.body;

    // ------------------ 1️⃣ VALIDATE PAYMENT (Delivery = UPI only) ------------------
    if (paymentMethod !== "UPI") {
      return res.status(400).json({
        success: false,
        message: "Delivery orders only support UPI payments.",
      });
    }

    const isOnlinePayment = true;
    const isPaid = false;
    const orderStatus = "In-process";

    // ------------------ 2️⃣ GET SAVED DELIVERY PREFERENCE ------------------
    const pref = await DeliveryPreference.findOne({ user: userId }).lean();
    if (!pref || !pref.addressId) {
      return res.status(400).json({
        success: false,
        message: "Select delivery address first.",
      });
    }

    // coupon priority (same as reviewOrder)
    const appliedCouponCode = pref.couponCode || null;

    // ------------------ 3️⃣ VALIDATE SHIPPING ADDRESS ------------------
    const shippingAddress = await Address.findById(pref.addressId).lean();
    if (!shippingAddress) {
      return res.status(404).json({
        success: false,
        message: "Delivery address not found.",
      });
    }

    // ------------------ 4️⃣ FETCH CART ------------------
    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: "items.product",
        select: "name price vendor images unit",
      })
      .lean();

    if (!cart || !cart.items.length) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }

    const validItems = cart.items.filter(i => i.product);
    if (!validItems.length) {
      return res.status(400).json({
        success: false,
        message: "Cart contains invalid products.",
      });
    }

    // ------------------ 5️⃣ VALIDATE COUPON ------------------
    let coupon = null;

    if (appliedCouponCode) {
      coupon = await Coupon.findOne({
        code: appliedCouponCode.toUpperCase(),
        status: "Active",
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      if (!coupon) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired coupon.",
        });
      }

      const used = coupon.usedBy.find(u => u.user.toString() === userId.toString());
      if (coupon.usageLimitPerUser && used && used.count >= coupon.usageLimitPerUser) {
        return res.status(400).json({
          success: false,
          message: `You already used this coupon ${coupon.usageLimitPerUser} times.`,
        });
      }

      if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit) {
        return res.status(400).json({
          success: false,
          message: "Coupon usage limit finished.",
        });
      }
    }

    // ------------------ 6️⃣ GROUP ITEMS BY VENDOR ------------------
    const itemsByVendor = {};
    validItems.forEach(i => {
      const vId = i.product.vendor.toString();
      if (!itemsByVendor[vId]) itemsByVendor[vId] = [];
      itemsByVendor[vId].push(i);
    });

    const createdOrderIds = [];
    const payments = [];
    let grandTotal = 0;
    let totalDiscount = 0;

    // ------------------ 7️⃣ PROCESS VENDOR-WISE ORDER ------------------
    for (const vendorId in itemsByVendor) {
      const vendorItems = itemsByVendor[vendorId];

      // ⭐ FIX: Use same delivery summary as reviewOrder
      const { summary } = await calculateOrderSummary(
        {
          items: vendorItems,
          user: userId,
          addressId: pref.addressId
        },
        appliedCouponCode,
        "Delivery"
      );

      const vendor = await User.findById(vendorId).select("name upiId").lean();
      if (!vendor?.upiId) {
        return res.status(400).json({
          success: false,
          message: `Vendor ${vendor?.name || ""} UPI ID missing.`,
        });
      }

      grandTotal += summary.totalAmount;
      totalDiscount += summary.discount || 0;

      // ------------------ CREATE ORDER ------------------
      const newOrder = await Order.create({
        orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`,
        buyer: userId,
        vendor: vendorId,
        products: vendorItems.map(i => ({
          product: i.product._id,
          quantity: i.quantity,
          price: i.product.price,
        })),
        totalPrice: summary.totalAmount,
        discount: summary.discount,
        couponCode: appliedCouponCode,
        orderType: "Delivery",
        shippingAddress,
        pickupSlot: null,
        comments: comments || "",
        paymentMethod,
        isPaid,
        orderStatus,
      });

      createdOrderIds.push(newOrder._id);

      // ------------------ 🔔 NOTIFICATIONS ------------------
      await createAndSendNotification(
        req,
        "📦 New Delivery Order",
        `You received a new delivery order (${newOrder.orderId}).`,
        { orderId: newOrder._id, amount: summary.totalAmount },
        "Vendor",
        vendorId
      );

      await createAndSendNotification(
        req,
        "🛍️ Order Placed",
        `Your delivery order (${newOrder.orderId}) has been placed.`,
        { orderId: newOrder._id, amount: summary.totalAmount },
        "Buyer",
        userId
      );

      // ------------------ 💳 PAYMENT QR ------------------
      const ref = `TXN-${newOrder.orderId.replace("#", "-")}-${Date.now()}`;
      const upiUrl = `upi://pay?pa=${vendor.upiId}&pn=${vendor.name}&am=${summary.totalAmount}&tn=${newOrder.orderId}&tr=${ref}&cu=INR`;
      const qrCode = await QRCode.toDataURL(upiUrl);

      payments.push({
        orderId: newOrder._id,
        vendorName: vendor.name,
        upiId: vendor.upiId,
        amount: summary.totalAmount,
        upiUrl,
        qrCode,
        comments
      });
    }

    // ------------------ 8️⃣ UPDATE COUPON USAGE ------------------
    if (coupon) {
      coupon.usedCount++;
      const used = coupon.usedBy.find(u => u.user.toString() === userId.toString());
      if (used) used.count++;
      else coupon.usedBy.push({ user: userId, count: 1 });

      if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit)
        coupon.status = "Expired";

      await coupon.save();
    }

    // ------------------ 9️⃣ CLEAR CART ------------------
    await Cart.updateOne(
      { user: userId },
      { $set: { items: [], couponCode: null } }
    );

    // ------------------ 🔟 FINAL RESPONSE ------------------
    return res.json({
      success: true,
      message: "Delivery orders created. Complete UPI payment to confirm.",
      orderIds: createdOrderIds,
      totalAmount: grandTotal,
      discount: totalDiscount,
      paymentMethod,
      address: shippingAddress,
      payments
    });

  } catch (error) {
    console.error("Delivery Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to place delivery order",
      error: error.message
    });
  }
});




const reviewOrder = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1️⃣ Fetch saved preference
  const pref = await DeliveryPreference.findOne({ user: userId }).lean();
  if (!pref) {
    return res.status(400).json({
      success: false,
      message: "Select delivery type first."
    });
  }

  // Delivery only
  const { addressId, couponCode: prefCoupon } = pref;

  // 2️⃣ Delivery requires address
  if (!addressId) {
    return res.status(400).json({
      success: false,
      message: "Address ID is required for Delivery.",
    });
  }

  const deliveryAddress = await Address.findById(addressId).lean();
  if (!deliveryAddress) {
    return res.status(404).json({
      success: false,
      message: "Address not found.",
    });
  }

  // 3️⃣ Fetch cart
  const cart = await Cart.findOne({ user: userId })
    .populate({
      path: "items.product",
      select: "name price images vendor weightPerPiece category variety sku unit",
      populate: {
        path: "vendor category",
        select: "name address location vendorDetails",
      },
    })
    .lean();

  if (!cart || !cart.items.length) {
    return res.status(400).json({
      success: false,
      message: "Your cart is empty.",
    });
  }

  const validItems = cart.items.filter(i => i.product);

  // ⭐ FINAL COUPON — CART > PREF
  const finalCouponCode = cart.couponCode || prefCoupon || null;

  // 4️⃣ Calculate summary (VERY IMPORTANT FIX)
  const { summary, items: updatedItems } = await calculateOrderSummary(
    {
      items: validItems,
      user: userId   // 🔥 ONLY pass user here
    },
    finalCouponCode,
    "Delivery"
  );

  // 5️⃣ Build response items
  const buyer = await User.findById(userId)
    .select("address location")
    .lean();

  let categoryIds = new Set();

  const finalItems = updatedItems.map((i) => {
    const p = i.product;
    const vendor = p.vendor;

    if (p.category?._id) categoryIds.add(p.category._id.toString());

    const est = calculateEstimatedDelivery(vendor, buyer);

    return {
      id: p._id,
      name: p.name,
      subtitle: p.variety || "",
      mrp: p.price,
      imageUrl: p.images?.[0] || "",
      quantity: i.quantity,
      unit: p.unit || "",
      category: p.category?.name || "",
      deliveryText: est.deliveryText,

      itemMRP: i.itemMRP,
      discount: i.discount,
      total: i.total,

      vendor: {
        id: vendor._id,
        name: vendor.name,
        address: vendor.address,
        location: vendor.vendorDetails?.location
      }
    };
  });

  // 6️⃣ Similar products
  const similarProductsRaw = await Product.find({
    category: { $in: [...categoryIds] },
    _id: { $nin: finalItems.map((x) => x.id) },
  })
    .select("name price images unit rating weightPerPiece vendor")
    .limit(12)
    .populate("vendor", "name")
    .lean();

  const similarProducts = similarProductsRaw.map((p) => ({
    id: p._id,
    name: p.name,
    price: p.price,
    unit: p.unit,
    imageUrl: p.images?.[0] || "",
    vendor: p.vendor?.name || "",
    rating: p.rating,
    weightPerPiece: p.weightPerPiece,
  }));

  // 7️⃣ FINAL RESPONSE
  return res.json({
    success: true,
    data: {
      items: finalItems,

      summary: {
        totalMRP: summary.totalMRP,
        couponDiscount: summary.discount,
        deliveryCharge: summary.deliveryCharge,
        totalAmount: summary.totalAmount,
      },

      priceDetails: {
        totalMRP: summary.totalMRP,
        couponDiscount: summary.discount,
        deliveryCharge: summary.deliveryCharge,
        totalAmount: summary.totalAmount,
      },

      couponCode: finalCouponCode || "",
      similarProducts,
      deliveryType: "Delivery",
      address: deliveryAddress,
      pickupSlot: null,
    },
  });
});







const saveDeliveryAddress = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { addressId } = req.body;

  if (!addressId) {
    return res.status(400).json({
      success: false,
      message: "addressId is required"
    });
  }

  // validate address
  const address = await Address.findById(addressId).lean();
  if (!address) {
    return res.status(404).json({
      success: false,
      message: "Address not found"
    });
  }

  const pref = await DeliveryPreference.findOneAndUpdate(
    { user: userId },
    { $set: { deliveryType: "Delivery", addressId } },
    { new: true, upsert: true }
  );

  return res.json({
    success: true,
    message: "Delivery address saved",
    data: pref
  });
});







const applyCouponToCart = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const userId = req.user._id;

  if (!code) {
    return res.status(400).json({
      success: false,
      message: "Coupon code required."
    });
  }

  const couponCode = code.trim().toUpperCase();

  // ========== Fetch Cart ==========
  const cart = await Cart.findOne({ user: userId })
    .populate({
      path: "items.product",
      populate: { path: "category", select: "name" }
    })
    .lean();

  if (!cart || !cart.items.length) {
    return res.status(404).json({ success: false, message: "Your cart is empty." });
  }

  // ========== Fetch Coupon ==========
  const coupon = await Coupon.findOne({ code: couponCode }).lean();
  if (!coupon) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired coupon."
    });
  }

  // ========== Validate Dates & Limits ==========
  if (coupon.status !== "Active")
    return res.status(400).json({ success: false, message: "Coupon inactive." });

  if (new Date(coupon.startDate) > new Date())
    return res.status(400).json({ success: false, message: "Coupon not started yet." });

  if (new Date(coupon.expiryDate) < new Date())
    return res.status(400).json({ success: false, message: "Coupon expired." });

  const userUsage = coupon.usedBy?.find(u => u.user.toString() === userId.toString());
  if (coupon.usageLimitPerUser && userUsage?.count >= coupon.usageLimitPerUser)
    return res.status(400).json({ success: false, message: "Usage limit reached." });

  // ========== Calculate MRP & Eligible MRP ==========
  let totalMRP = 0;
  let eligibleMRP = 0;

  cart.items.forEach(item => {
    const p = item.product;
    const qty = item.quantity;
    const itemTotal = p.price * qty;

    totalMRP += itemTotal;

    const categoryId = p.category?._id?.toString();
    const categoryName = p.category?.name;

    const appliesTo = coupon.appliesTo.map(v => v.toString());

    const isAll = appliesTo.includes("All Products");
    const isCategoryIdMatch = appliesTo.includes(categoryId);
    const isCategoryNameMatch = appliesTo.includes(categoryName);

    const isProductMatch = coupon.applicableProducts?.some(
      pid => pid.toString() === p._id.toString()
    );

    if (isAll || isCategoryIdMatch || isCategoryNameMatch || isProductMatch) {
      eligibleMRP += itemTotal;
    }
  });

  // ========== Minimum Order Check ==========
  if (coupon.minimumOrder && totalMRP < coupon.minimumOrder) {
    return res.status(400).json({
      success: false,
      message: `Minimum order amount for this coupon is ₹${coupon.minimumOrder}.`
    });
  }

  // ========== Calculate Discount ==========
  let discount = 0;

  if (eligibleMRP > 0) {
    if (coupon.discount.type === "Percentage") {
      discount = (eligibleMRP * coupon.discount.value) / 100;
    } else {
      discount = Math.min(coupon.discount.value, eligibleMRP);
    }
  }

  const totalAmount = totalMRP - discount;

  // Save coupon in cart
  await Cart.updateOne(
    { user: userId },
    { $set: { couponCode: couponCode } }
  );

  return res.json({
    success: true,
    message: "Coupon applied successfully.",
    summary: {
      totalMRP,
      discount,
      deliveryCharge: 0,
      totalAmount
    },
    priceDetails: {
      totalMRP,
      discount,
      deliveryCharge: 0,
      totalAmount
    },
    couponCode: couponCode
  });
});







const addItemToCart = asyncHandler(async (req, res) => {
    const { productId, quantity = 1 } = req.body;
    const userId = req.user._id;

    if (!productId || quantity <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Product ID and valid quantity are required.'
        });
    }

    // 1️⃣ Fetch product
    const product = await Product.findById(productId)
        .select('name price weightPerPiece vendor status images unit variety');

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (product.status !== 'In Stock' || product.price == null) {
        return res.status(400).json({
            success: false,
            message: 'Product is out of stock or invalid.'
        });
    }

    // 2️⃣ Find or create cart
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
        cart = await Cart.create({ user: userId, items: [] });
    }

    // ❌❌ Vendor restriction REMOVED completely
    // ----------------------------------------------------
    // const existingVendors = cart.items.map(i => i.vendor?.toString()).filter(Boolean);
    // if (existingVendors.length > 0 && existingVendors[0] !== product.vendor.toString()) {
    //     return res.status(400).json({ message: 'Only one vendor allowed' });
    // }
    // ----------------------------------------------------

    // 3️⃣ Add or update product
    const existingItemIndex = cart.items.findIndex(
        i => i.product && i.product.toString() === productId
    );

    if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity += Number(quantity);
        cart.items[existingItemIndex].price = product.price;
    } else {
        cart.items.push({
            product: product._id,
            vendor: product.vendor,
            quantity: Number(quantity),
            price: product.price
        });
    }

    await cart.save();

    // 4️⃣ Populate for summary (unchanged)
    const populatedForSummary = await Cart.findById(cart._id)
        .populate({
            path: "items.product",
            select: "name price weightPerPiece vendor category"
        })
        .lean();

    const summary = await calculateOrderSummary(
        {
            items: populatedForSummary.items,
            user: userId,
            addressId: null
        },
        cart.couponCode,
        "Delivery"
    );

    // 5️⃣ Final client response
    const populatedCart = await Cart.findById(cart._id)
        .populate("items.product", "name price variety images unit vendor")
        .lean();

    const items = populatedCart.items.map(i => ({
        id: i.product._id,
        name: i.product.name,
        subtitle: i.product.variety || '',
        mrp: i.price,
        imageUrl: i.product.images?.[0] || null,
        quantity: i.quantity,
        unit: i.product.unit,
        vendorId: i.vendor
    }));

    res.status(200).json({
        success: true,
        message: 'Item added successfully.',
        data: {
            items,
            summary
        }
    });
});





const removeItemFromCart = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const cart = await Cart.findOne({ user: req.user._id })
        .populate('items.product');

    if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    const initialLength = cart.items.length;

    // 🛡 Remove missing products + remove requested product
    cart.items = cart.items.filter((item) => {
        // ❌ If product is null → REMOVE item
        if (!item.product) return false;

        // ❌ If this is the product to remove → REMOVE
        return item.product._id.toString() !== id;
    });

    if (cart.items.length === initialLength) {
        return res.status(404).json({ success: false, message: 'Item not found in cart' });
    }

    // 🧮 Recalculate total (all items guaranteed valid now)
    cart.totalPrice = cart.items.reduce(
        (total, item) => total + item.price * item.quantity,
        0
    );

    await cart.save();

    res.json({
        success: true,
        message: "Item removed from cart",
        data: cart,
    });
});



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



const getVendorProfileForBuyer = asyncHandler(async (req, res) => {
  const { vendorId } = req.params;
  let { buyerLat, buyerLng, category } = req.query;

  // 🟢 Step 1: Fetch Vendor
  const vendor = await User.findById(vendorId)
    .where("role").equals("Vendor")
    .where("status").equals("Active")
    .select("name profilePicture address vendorDetails location rating comments mobileNumber");

  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: "Vendor not found or inactive.",
    });
  }

  // 📏 Step 2: Distance Helper
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lat2 - lat2);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 🟢 Step 3: Auto-fetch Buyer Location
  let buyerHasLocation = false;
  if ((!buyerLat || !buyerLng) && req.user?._id) {
    const buyer = await User.findById(req.user._id).select("location");
    if (buyer?.location?.coordinates?.length === 2) {
      buyerLng = buyer.location.coordinates[0];
      buyerLat = buyer.location.coordinates[1];
      buyerHasLocation = true;
    }
  } else if (buyerLat && buyerLng) {
    buyerHasLocation = true;
  }

  // 🟢 Step 4: Distance Text
  let distanceText = "Please update your delivery address to view distance.";
  if (buyerHasLocation && vendor.location?.coordinates?.length === 2) {
    const [vendorLng, vendorLat] = vendor.location.coordinates;
    const distance = getDistanceKm(
      parseFloat(buyerLat),
      parseFloat(buyerLng),
      parseFloat(vendorLat),
      parseFloat(vendorLng)
    );
    if (!isNaN(distance)) distanceText = `${distance.toFixed(2)} km away`;
  }

  // 🟢 Step 5: Vendor Products → IDs
  const vendorProducts = await Product.find({ vendor: vendorId }).select("_id");
  const productIds = vendorProducts.map((p) => p._id);

  // 🟢 Step 6: Reviews
  const reviewsRaw = await Review.find({ product: { $in: productIds } })
    .populate("user", "name profilePicture")
    .sort({ createdAt: -1 })
    .limit(5);

  const reviews = reviewsRaw.map((r) => ({
    _id: r._id,
    user: r.user,
    rating: r.rating,
    comment: r.comment || "",
    images: r.images,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  const reviewCount = await Review.countDocuments({ product: { $in: productIds } });

  // 🟢 Step 7: Real-time Rating Calculation
  const ratingAgg = await Review.aggregate([
    { $match: { product: { $in: productIds } } },
    { $group: { _id: null, avgRating: { $avg: "$rating" } } },
  ]);

  const avgVendorRating = ratingAgg[0]?.avgRating ?? vendor.rating ?? 0;
  const vendorFinalRating = parseFloat(avgVendorRating.toFixed(1));

  await User.findByIdAndUpdate(vendorId, { rating: vendorFinalRating });

  // 🟢 Step 8: Listed Products + CATEGORY POPULATION
  const productFilter = { vendor: vendorId, status: "In Stock" };
  if (category) productFilter.category = category;

  const listedProductsRaw = await Product.find(productFilter)
    .select("name category variety price quantity unit images rating")
    .populate("category", "name image") // ⭐ ADD CATEGORY NAME + IMAGE
    .sort({ rating: -1 })
    .limit(20);

  // Format products with full category info
  const listedProducts = listedProductsRaw.map((p) => ({
    id: p._id,
    name: p.name,
    price: p.price,
    unit: p.unit,
    rating: p.rating || 0,
    quantity: p.quantity,
    images: p.images,
    variety: p.variety,

    // ⭐ CATEGORY DETAILS
    categoryId: p.category?._id || null,
    categoryName: p.category?.name || null,
    categoryImage: p.category?.image || null,
  }));

  // 🟢 Step 9: Available Categories FULL DETAILS (NOT ONLY IDs)
  const categoryIds = await Product.distinct("category", { vendor: vendorId });

  const availableCategories = await Category.find({ _id: { $in: categoryIds } })
    .select("_id name image"); // ⭐ return full category info

  // 🟢 Step 10: Address Formatting
  const addr = vendor.address || {};
  const fullAddressText = [
    addr.houseNumber,
    addr.street,
    addr.locality,
    addr.district,
    addr.city,
    addr.state,
    addr.pinCode,
  ]
    .filter(Boolean)
    .join(", ");

  // 🟢 Step 11: Response
  res.status(200).json({
    success: true,
    data: {
      vendor: {
        id: vendor._id,
        name: vendor.name,
        mobileNumber: vendor.mobileNumber,
        profilePicture: vendor.profilePicture,
        locationText: `${fullAddressText} (${distanceText})`,
        distance: distanceText,
        about: vendor.vendorDetails?.about || "",
        rating: vendorFinalRating,
        farmImages: vendor.vendorDetails?.farmImages || [],
        fullAddress: {
          ...addr,
          latitude: addr.latitude || null,
          longitude: addr.longitude || null,
        },
      },

      reviews: {
        count: reviewCount,
        list: reviews,
      },

      listedProducts,
      availableCategories,
    },
  });
});




const getProductReviews = asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    // 1. Fetch Product Name/Details for Context
    // ✅ Include price and description in the select statement
    const product = await Product.findById(productId)
        .select('name variety category images weightPerPiece rating price description')
        .lean();

    if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
    }

    // 2. Fetch all reviews for this product
    const reviewsRaw = await Review.find({ product: productId })
        .populate('user', 'name profilePicture')
        .select('rating comment images createdAt')
        .sort({ createdAt: -1 })
        .lean();

    // 3. Calculate Average Rating and Total Reviews
    const totalReviews = reviewsRaw.length;
    const averageRating = totalReviews > 0
        ? (reviewsRaw.reduce((sum, review) => sum + review.rating, 0) / totalReviews).toFixed(1)
        : 0;

    // 4. Format Reviews for UI
    const formattedReviews = reviewsRaw.map(r => {
        // Helper to format date as DD/MM/YYYY
        const formatDate = (date) => new Date(date).toLocaleDateString('en-GB');

        return {
            id: r._id,
            user: {
                name: r.user.name,
                profilePicture: r.user.profilePicture,
            },
            // Individual rating (using 1 decimal place as in the UI)
            rating: parseFloat(r.rating).toFixed(1) || '0.0',
            reviewImages: r.images || [],
            comment: r.comment || 'No comment provided.',
            date: formatDate(r.createdAt),
        };
    });

    // Extract images for the main preview carousel (top of the page)
    const allReviewImages = reviewsRaw
        .flatMap(r => r.images)
        .filter(url => url)
        .slice(0, 5); // Limit the top carousel to 5 images


    // 5. Structure Final Response
    res.status(200).json({
        success: true,
        data: {
            // ✅ Product Details (for the "About the product" section and header)
            product: {
                id: product._id,
                name: product.name, // e.g., Mango Chausa
                category: product.category, // e.g., Fruits
                description: product.description || 'Product description not available.', // Product description
                price: product.price, // Price

                // Header Display Fields
                headerImage: product.images?.[0] || null, // Top background image
                averageRating: parseFloat(averageRating).toFixed(1), // e.g., 6.2
                totalReviews: totalReviews,
            },

            // ✅ Top Image Carousel Data (for the quick preview section)
            reviewImageCarousel: allReviewImages,

            // ✅ Full Review List Data
            reviews: formattedReviews,
        }
    });
});

const reorder = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    // 1️⃣ Find the old order
    const oldOrder = await Order.findOne({ _id: orderId, buyer: req.user._id }).populate('vendor');
    if (!oldOrder) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 2️⃣ Create a new order
    const newOrder = await Order.create({
        orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`,
        buyer: req.user._id,
        vendor: oldOrder.vendor._id,
        items: oldOrder.items,
        totalPrice: oldOrder.totalPrice,
        deliveryMethod: oldOrder.deliveryMethod,
        orderType: "Reorder",     // ✅ FIXED (Required),
        status: 'In Process',
    });

    // 3️⃣ Send Notifications (Buyer + Vendor only)

    // 🔹 Buyer (personal)
    await createAndSendNotification(
        req,
        '🛒 Reorder Placed',
        `Your reorder (${newOrder.orderId}) has been successfully placed.`,
        { orderId: newOrder.orderId }, // ✅ Now sends readable ORDER#xxxxx
        'Buyer',
        req.user._id
    );

    // 🔹 Vendor (personal)
    if (oldOrder.vendor) {
        await createAndSendNotification(
            req,
            '📦 New Reorder Received',
            `A new reorder has been placed (${newOrder.orderId}).`,
            { orderId: newOrder.orderId }, // ✅ human-readable ID
            'Vendor',
            oldOrder.vendor._id
        );
    }

    // 4️⃣ Response
    res.status(201).json({
        success: true,
        message: 'Reorder placed successfully and notifications sent.',
        data: newOrder,
    });
});













const verifyPayment = asyncHandler(async (req, res) => {
    const { orderId, transactionId } = req.body;

    // 1️⃣ Validate input
    if (!orderId || !transactionId) {
        return res.status(400).json({
            success: false,
            message: "orderId and transactionId are required.",
        });
    }

    // 2️⃣ Find order
    const order = await Order.findById(orderId)
        .populate("buyer", "name _id")
        .populate("vendor", "name _id");
    if (!order) {
        return res
            .status(404)
            .json({ success: false, message: "Order not found." });
    }

    // 3️⃣ Check current status
    if (order.orderStatus !== "Pending Payment") {
        return res.status(400).json({
            success: false,
            message: `Order cannot be verified. Current status: ${order.orderStatus}`,
        });
    }

    // 4️⃣ Update payment status
    order.orderStatus = "Paid";
    order.isPaid = true;
    order.transactionId = transactionId;
    await order.save();

    // 5️⃣ Send Notifications
    const dataPayload = {
        orderId: order._id,
        transactionId,
        totalAmount: order.totalPrice,
    };

    // 🔹 Buyer notification (personal)
    await createAndSendNotification(
        req,
        "💳 Payment Successful",
        `Your payment for order ${order.orderId} has been verified successfully.`,
        dataPayload,
        "Buyer",
        order.buyer?._id
    );

    // 🔹 Vendor notification (personal)
    if (order.vendor?._id) {
        await createAndSendNotification(
            req,
            "💰 Order Payment Received",
            `Payment for order ${order.orderId} has been verified successfully.`,
            dataPayload,
            "Vendor",
            order.vendor._id
        );
    }

    // 🔹 Admin notification (all admins)
    await createAndSendNotification(
        req,
        "🧾 Payment Verified",
        `Payment for order ${order.orderId} by ${order.buyer?.name || "a buyer"} has been successfully verified.`,
        dataPayload,
        "Admin"
    );

    // 6️⃣ Send response
    res.status(200).json({
        success: true,
        message: "Payment verified successfully and notifications sent.",
        order,
    });
});



const getBuyerOrders = asyncHandler(async (req, res) => {
    const buyerId = req.user._id;

    // 1️⃣ Fetch all orders for the buyer
    const orders = await Order.find({ buyer: buyerId })
        .sort({ createdAt: -1 })
        .lean();

    // 2️⃣ Populate product + vendor (with address & profilePicture)
    const populatedOrders = await Promise.all(
        orders.map(async (order) => {
            const items = Array.isArray(order.products)
                ? await Promise.all(
                    order.products.map(async (item) => {
                        if (!item || !item.product) return null;

                        const product = await Product.findById(item.product)
                            .select('name images unit quantity weightPerPiece price vendor')
                            .lean();
                        if (!product) return null;

                        // Get vendor details
                        const vendor = await User.findById(product.vendor)
                            .select('name address profilePicture mobileNumber')
                            .lean();

                        return {
                            ...item,
                            product,
                            vendor,
                        };
                    })
                )
                : [];

            return {
                ...order,
                items: items.filter(Boolean),
            };
        })
    );

    // 3️⃣ Send response
    res.status(200).json({
        success: true,
        orders: populatedOrders,
    });
});


const getOrderDetails = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    // ✅ 1. Find the order for the logged-in buyer
    const order = await Order.findOne({ _id: orderId, buyer: req.user._id })
        .populate("buyer", "name mobileNumber")
        .lean();

    if (!order) {
        return res.status(404).json({
            success: false,
            message: "Order not found.",
        });
    }

    // ✅ 2. Extract product IDs
    const productIds = (order.products || []).map((item) => item.product);

    // ✅ 3. Fetch product and vendor details
    const products = await Product.find({ _id: { $in: productIds } })
        .select("name images variety price unit vendor quantity weightPerPiece description category")
        .populate("vendor", "name profilePicture mobileNumber address vendorDetails.about location state deliveryRegion")
        .lean();

    // ✅ 4. Fetch all product reviews in one query
    const reviews = await Review.find({ product: { $in: productIds } })
        .populate("user", "name profilePicture")
        .sort({ createdAt: -1 })
        .select("product rating comment images createdAt")
        .lean();

    // ✅ 5. Group reviews by product
    const reviewsMap = reviews.reduce((acc, review) => {
        const pid = review.product.toString();
        acc[pid] = acc[pid] || [];
        acc[pid].push({
            id: review._id,
            rating: review.rating,
            comment: review.comment,
            images: review.images || [],
            createdAt: review.createdAt,
            user: review.user || null,
        });
        return acc;
    }, {});

    // ✅ 6. Merge order items with product & vendor details
    const items = order.products
        .map((item) => {
            const product = products.find((p) => p._id.toString() === item.product.toString());
            if (!product) return null;

            const vendor = product.vendor || {};
            return {
                id: product._id,
                name: product.name,
                description: product.description || "",
                category: product.category || "",
                subtext: product.variety || "",
                quantity: item.quantity,
                price: product.price,
                unit: product.unit,
                weightPerPiece: product.weightPerPiece,
                image: product.images?.[0] || null,
                vendor: {
                    id: vendor._id,
                    name: vendor.name,
                    mobileNumber: vendor.mobileNumber,
                    address:
                        vendor.address ||
                        vendor.vendorDetails?.address ||
                        vendor.vendorDetails?.businessAddress ||
                        null,
                    profilePicture: vendor.profilePicture,
                    about: vendor.vendorDetails?.about || "",
                    location: vendor.location,
                    state: vendor.state,
                    deliveryRegion: vendor.deliveryRegion,
                },
                reviews: reviewsMap[product._id.toString()] || [],
            };
        })
        .filter(Boolean);

    // ✅ 7. Group items by vendor
    const vendorGroups = items.reduce((acc, item) => {
        const vendorId = item.vendor.id.toString();
        if (!acc[vendorId]) acc[vendorId] = { vendor: item.vendor, items: [] };
        acc[vendorId].items.push(item);
        return acc;
    }, {});

    // ✅ 8. Calculate delivery charges per vendor (skip if paymentMethod is UPI)
    const vendorList = [];
    for (const [vendorId, group] of Object.entries(vendorGroups)) {
        const totalWeight = group.items.reduce(
            (sum, i) => sum + (i.weightPerPiece || 0.2) * i.quantity,
            0
        );

        let deliveryCharge = 0;

        // 👇 Skip calculation if payment is via UPI
        if (order.paymentMethod !== "UPI") {
            deliveryCharge = await getDeliveryCharge(req.user._id, vendorId, totalWeight);
        }

        vendorList.push({
            ...group.vendor,
            deliveryCharge,
        });
    }

    // ✅ 9. Format date
    const formatDate = (date) =>
        date
            ? new Date(date).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "short",
                day: "numeric",
            })
            : null;

    // ✅ 10. Final response
    res.status(200).json({
        success: true,
        order: {
            id: order._id,
            orderId: order.orderId,
            buyer: order.buyer,
            paymentMethod: order.paymentMethod,
            totalPrice: order.totalPrice,
            discount: order.discount || 0,
            orderStatus: order.orderStatus,
            orderType: order.orderType,
            createdAt: order.createdAt,
            deliveryDate: formatDate(order.createdAt),
            pickupSlot: order.pickupSlot || null,
            comments: order.comments || "",
            shippingAddress: order.shippingAddress || {},
            vendors: vendorList,
            items,
        },
    });
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
    if (bestCoupon.applicableId) console.log(`Applicable ID: ${bestCoupon.applicableId}`);

    // 4️⃣ Return response
    res.status(200).json({
        success: true,
        message: 'Best active coupon retrieved successfully.',
        data: bestCoupon
    });
});




const getWishlist = asyncHandler(async (req, res) => {
    const { page = 1, limit = 1000 } = req.query; // default: page 1, 10 items per page
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const buyer = await User.findById(req.user._id);
    if (!buyer) {
        return res.status(404).json({ success: false, message: 'Buyer not found.' });
    }

    const wishlist = await Wishlist.findOne({ user: req.user._id }).populate('items.product');
    if (!wishlist || !wishlist.items.length) {
        return res.status(200).json({ success: true, data: { items: [], totalItems: 0, totalPages: 0, currentPage: 1 } });
    }

    // Filter out null products
    const validItems = wishlist.items.filter(item => item.product);

    // Pagination
    const paginatedItems = validItems.slice(skip, skip + parseInt(limit));

    const items = await Promise.all(
        paginatedItems.map(async (item) => {
            const product = item.product;

            const vendor = await User.findById(product.vendor)
                .where('role').equals('Vendor')
                .where('status').equals('Active')
                .select('name profilePicture mobileNumber vendorDetails location address');

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
                quantity:product.quantity,
                unit: product.unit,
                weightPerPiece: product.weightPerPiece,
                vendor: vendor
                    ? {
                        id: vendor._id,
                        name: vendor.name,
                        mobileNumber: vendor.mobileNumber || null,
                        profilePicture: vendor.profilePicture || null,
                        locationText: vendor.address?.locality || vendor.address?.city || 'Unknown Location',
                        distance,
                        about: vendor.vendorDetails?.about || '',
                    }
                    : null,
            };
        })
    );

    res.status(200).json({
        success: true,
        data: {
            items: items.filter(i => i !== null), // remove null items if any
            totalItems: validItems.length,
            totalPages: Math.ceil(validItems.length / parseInt(limit)),
            currentPage: parseInt(page),
        },
    });
});




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
                    weightPerPiece: product.weightPerPiece,
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



const removeFromWishlist = asyncHandler(async (req, res) => {
    const { productId } = req.params; // get from URL
    const userId = req.user._id;

    if (!productId) {
        return res.status(400).json({ success: false, message: 'Product ID is required.' });
    }

    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
        return res.status(404).json({ success: false, message: 'Wishlist not found.' });
    }

    const itemIndex = wishlist.items.findIndex(item => item.product.toString() === productId);
    if (itemIndex === -1) {
        return res.status(404).json({ success: false, message: 'Product not found in wishlist.' });
    }

    wishlist.items.splice(itemIndex, 1);
    await wishlist.save();

    res.status(200).json({
        success: true,
        message: 'Product removed from wishlist successfully.',
        data: { productId }
    });
});



// ⭐ Add this function ABOVE writeReview
const calculateNewRating = async (productId, newRating) => {
  const product = await Product.findById(productId);

  if (!product) return newRating;

  // total old rating sum
  const oldTotal = product.rating * product.ratingCount;

  // new total
  const newTotal = oldTotal + newRating;

  // return average
  return newTotal / (product.ratingCount + 1);
};


const writeReview = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { rating, comment, orderId } = req.body;

  // 1️⃣ Validate Rating
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  // 2️⃣ Validate Order
  const order = await Order.findById(orderId)
    .populate("products.product")
    .populate("vendor", "name _id expoPushToken");

  if (!order || order.buyer.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to review this order.",
    });
  }

  // 3️⃣ Product must belong to the order
  const productInOrder = order.products.find(
    (item) => item.product._id.toString() === productId.toString()
  );

  if (!productInOrder) {
    return res.status(400).json({
      success: false,
      message: "Product not found in this order.",
    });
  }

  // ❌❌ 4️⃣ Duplicate checking REMOVED (Multiple reviews allowed)
  // const existing = await Review.findOne({
  //   product: productId,
  //   user: req.user._id,
  //   order: orderId,
  // });

  // if (existing) {
  //   return res.status(400).json({
  //     success: false,
  //     message: "You have already reviewed this product for this order.",
  //   });
  // }

  // 5️⃣ Upload Review Images
  const images = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const uploaded = await cloudinaryUpload(file.path, "product-reviews");
      images.push(uploaded.secure_url);
    }
  }

  // 6️⃣ Create Review
  const review = await Review.create({
    product: productId,
    user: req.user._id,
    rating,
    comment,
    images,
    order: orderId,
    orderItem: `${orderId}-${productId}-${Date.now()}`, // ⭐ Unique to allow multiple reviews
  });

  // 7️⃣ Populate Review for Response
  const populatedReview = await Review.findById(review._id)
    .populate("user", "name profilePicture")
    .populate("product", "name variety vendor");

  // ⭐⭐⭐ 7.5️⃣ PUSH REVIEW INTO PRODUCT + UPDATE RATING ⭐⭐⭐
  const newRatingValue = await calculateNewRating(productId, rating);

  await Product.findByIdAndUpdate(
    productId,
    {
      $push: { reviews: review._id },
      $inc: { ratingCount: 1 },
      $set: { rating: newRatingValue }
    }
  );

  // 8️⃣ Notifications
  await createAndSendNotification(
    req,
    "⭐ Review Submitted",
    `Your review for "${populatedReview.product.name}" has been submitted successfully.`,
    {
      reviewId: review._id,
      productId,
      rating,
      comment,
    },
    "Buyer",
    req.user._id
  );

  // Vendor notification
  if (populatedReview.product.vendor) {
    await createAndSendNotification(
      req,
      "💬 New Product Review",
      `${req.user.name || "A buyer"} reviewed your product "${populatedReview.product.name}".`,
      {
        reviewId: review._id,
        productId,
        rating,
        comment,
      },
      "Vendor",
      populatedReview.product.vendor.toString()
    );
  }

  // 9️⃣ Final Response
  res.status(201).json({
    success: true,
    message: "Review submitted successfully.",
    review: populatedReview,
  });
});



// oioihoihoiioh




const startCheckout = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // --- 1. Fetch Cart and Validate ---
    const cart = await Cart.findOne({ user: userId })
        .populate('items.product')
        .lean();

    if (!cart || cart.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    const validItems = cart.items.filter(i => i.product);
    if (validItems.length === 0) {
        return res.status(400).json({ success: false, message: 'All items in cart are invalid or deleted.' });
    }

    // --- 2. Calculate Final Summary (coupon handling included) ---
    const summaryResult = await calculateOrderSummary(cart, cart.couponCode);
    const summary = summaryResult?.summary || {};

    // Fallback numeric values to 0 to avoid toFixed errors
    const totalMRP = summary.totalMRP ?? 0;
    const discount = summary.discount ?? 0;
    const deliveryCharge = summary.deliveryCharge ?? 0;
    const totalAmount = summary.totalAmount ?? 0;

    // --- 3. Fetch Default Delivery Address ---
    const addresses = await Address.find({ user: userId }).sort({ isDefault: -1 }).lean();
    const defaultAddress = addresses.find(a => a.isDefault) || addresses[0] || null;

    // --- 4. Estimate Delivery Date ---
    const estimatedDelivery = calculateEstimatedDelivery(); // returns { formatted: 'Oct 14, 2025' }

    // --- 5. Donation + Total ---
    const donationAmount = 20;
    const finalTotalAmount = totalAmount + donationAmount;

    // --- 6. Format Cart Items ---
    const formattedItems = validItems.map(item => ({
        id: item.product._id,
        name: item.product.name,
        subtitle: item.product.variety || '',
        mrp: item.product.price ?? 0,
        imageUrl: item.product.images?.[0] || null,
        quantity: item.quantity,
        weightPerPiece: item.weightPerPiece,
        deliveryText: `Delivered by ${estimatedDelivery.formatted}`,
    }));

    // --- 7. Format Delivery Info ---
    const deliveryToText = defaultAddress
        ? `${defaultAddress.pinCode} (${defaultAddress.city})`
        : 'Select Delivery Location';

    // --- 8. Final Response ---
    res.status(200).json({
        success: true,
        data: {
            deliveryInfo: {
                deliverTo: deliveryToText,
                addressId: defaultAddress?._id || null,
                deliveryDateText: `Delivered by ${estimatedDelivery.formatted}`,
            },
            items: formattedItems,
            couponCode: cart.couponCode || '',
            suggestedDonation: donationAmount,
            priceDetails: {
                TotalMRP: `₹ ${totalMRP.toFixed(2)}`,
                CouponDiscount: `₹ ${discount.toFixed(2)}`,
                DeliveryCharge: `₹ ${deliveryCharge.toFixed(2)}`,
                Donation: `₹ ${donationAmount.toFixed(2)}`,
                TotalAmount: `₹ ${finalTotalAmount.toFixed(2)}`,
            },
            rawTotals: {
                totalMRP,
                discount,
                deliveryCharge,
                totalAmount,
                donation: donationAmount,
                finalTotal: finalTotalAmount,
            },
        },
    });
});


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



 const updateReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { rating, comment } = req.body;

  console.log("🔍 Incoming Review Update For ID:", reviewId);

  // 1️⃣ Find review with product + user
  let review = await Review.findById(reviewId)
    .populate("product", "name vendor")
    .populate("user", "name");

  if (!review) {
    console.log("❌ Review Not Found");
    return res.status(404).json({
      success: false,
      message: "Review not found",
    });
  }

  // 2️⃣ Authorization
  if (review.user._id.toString() !== req.user._id.toString()) {
    console.log("⛔ Unauthorized — User mismatch");
    return res.status(403).json({
      success: false,
      message: "Not authorized to edit this review",
    });
  }

  // 3️⃣ Validate rating if provided
  const oldRating = review.rating;
  let ratingChanged = false;
  if (rating !== undefined && rating !== null) {
    const parsed = Number(rating);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be a number between 1 and 5",
      });
    }
    if (parsed !== oldRating) ratingChanged = true;
    review.rating = parsed;
  }

  // 4️⃣ Update comment if provided
  if (comment !== undefined) review.comment = comment;

  // 5️⃣ Handle Images — Delete old + Upload new (if files provided)
  if (req.files && req.files.length > 0) {
    console.log("🗑 Deleting old review images...");

    if (review.images && review.images.length > 0) {
      for (const img of review.images) {
        try {
          const imgUrl = typeof img === "string" ? img : img.url;
          // NOTE: this assumes your public IDs are last part of the URL without extension
          const publicId = imgUrl.split("/").pop().split(".")[0];
          await cloudinaryDestroy(`product-reviews/${publicId}`);
        } catch (err) {
          console.error("❌ Error deleting old image:", err.message);
        }
      }
    }

    console.log("📤 Uploading new images...");
    const newImages = [];
    for (const file of req.files) {
      const uploaded = await cloudinaryUpload(file.path, "product-reviews");
      newImages.push(uploaded.secure_url);
    }
    review.images = newImages;
  }

  // 6️⃣ Save updated review
  await review.save();

  // 7️⃣ Re-fetch updated review with populates for response
  const updatedReview = await Review.findById(review._id)
    .populate("user", "name profilePicture")
    .populate("product", "name variety vendor");

  // 8️⃣ If rating changed -> recalculate avg rating & ratingCount for the product
  if (ratingChanged && updatedReview.product && updatedReview.product._id) {
    try {
      const agg = await Review.aggregate([
        { $match: { product: mongoose.Types.ObjectId(updatedReview.product._id) } },
        {
          $group: {
            _id: "$product",
            avgRating: { $avg: "$rating" },
            count: { $sum: 1 },
          },
        },
      ]);

      const avgRating = agg[0] ? Number(agg[0].avgRating.toFixed(2)) : 5;
      const count = agg[0] ? agg[0].count : 0;

      await Product.findByIdAndUpdate(
        updatedReview.product._id,
        { rating: avgRating, ratingCount: count },
        { new: true }
      );
    } catch (err) {
      console.error("❌ Failed to recalc product rating:", err);
      // don't fail the request for notification reasons — just log
    }
  }

  const product = updatedReview.product;

  // 9️⃣ Buyer Notification
  await createAndSendNotification(
    req,
    "✏️ Review Updated",
    `Your review for "${product.name}" has been updated successfully.`,
    {
      reviewId: updatedReview._id,
      productId: product._id,
      rating: updatedReview.rating,
      comment: updatedReview.comment,
    },
    "Buyer",
    req.user._id
  );

  // 🔟 Vendor Notification
  if (product.vendor) {
    await createAndSendNotification(
      req,
      "🔄 Product Review Updated",
      `${req.user.name || "A buyer"} updated their review on your product "${product.name}".`,
      {
        reviewId: updatedReview._id,
        productId: product._id,
        rating: updatedReview.rating,
        comment: updatedReview.comment,
      },
      "Vendor",
      product.vendor.toString()
    );
  }

  // 1️⃣1️⃣ Response
  res.status(200).json({
    success: true,
    message: "Review updated successfully.",
    review: updatedReview,
  });
});






const deleteReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  // 1️⃣ Find review
  const review = await Review.findById(reviewId).populate(
    "product",
    "name _id"
  );
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found",
    });
  }

  // 2️⃣ Authorization
  if (review.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to delete this review",
    });
  }

  // 3️⃣ Delete Cloudinary Images (SAFE)
  if (review.images && review.images.length > 0) {
    for (const imgUrl of review.images) {
      try {
        const publicId = imgUrl.split("/").pop().split(".")[0];
        await cloudinaryDestroy(`product-reviews/${publicId}`); // 🔥 Correct helper
      } catch (err) {
        console.error("Cloudinary delete error:", err.message);
      }
    }
  }

  // 4️⃣ Delete review from DB
  await review.deleteOne();

  // 5️⃣ Create notification (only bell, no push)
  const notification = await Notification.create({
    title: "🗑️ Review Deleted",
    message: `Your review for "${review.product?.name || "a product"}" has been deleted successfully.`,
    data: {
      reviewId,
      productId: review.product?._id,
    },
    userType: "Buyer",
    receiverId: req.user._id,
    isRead: false,
  });

  // 6️⃣ Send real-time bell notification
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers");

  if (onlineUsers && onlineUsers[req.user._id]) {
    io.to(onlineUsers[req.user._id].socketId).emit("notification", notification);
  }

  // 7️⃣ Response
  res.status(200).json({
    success: true,
    message: "Review deleted successfully.",
    reviewId,
  });
});





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
  // 1️⃣ Find Buyer
  const user = await User.findById(req.user.id);
  if (!user || user.role !== "Buyer") {
    return res.status(404).json({
      success: false,
      message: "Buyer not found.",
    });
  }

  // 2️⃣ Prevent duplicate mobile number
  if (req.body.mobileNumber && req.body.mobileNumber !== user.mobileNumber) {
    const existingUser = await User.findOne({
      mobileNumber: req.body.mobileNumber,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Mobile number already in use.",
      });
    }

    user.mobileNumber = req.body.mobileNumber;
  }

  // 3️⃣ Handle profile image update (Cloudinary)
  if (req.file) {
    try {
      // 🗑️ Delete old profile image (if exists)
      if (user.profilePicture) {
        const oldPublicId = user.profilePicture.split("/").pop().split(".")[0];
        await cloudinaryDestroy(`profile-images/${oldPublicId}`);
      }

      // 📤 Upload new image using helper
      const uploaded = await cloudinaryUpload(req.file.path, "profile-images");
      user.profilePicture = uploaded.secure_url;

    } catch (error) {
      console.error("⚠️ Cloudinary upload error:", error);
      return res.status(500).json({
        success: false,
        message: "Profile image upload failed.",
      });
    }
  }

  // 4️⃣ Update basic data
  if (req.body.name) user.name = req.body.name;

  // 5️⃣ Update address
  if (req.body.pinCode || req.body.city || req.body.locality || req.body.houseNumber) {
    user.address = {
      pinCode: req.body.pinCode || user.address?.pinCode,
      houseNumber: req.body.houseNumber || user.address?.houseNumber,
      locality: req.body.locality || user.address?.locality,
      city: req.body.city || user.address?.city,
      district: req.body.district || user.address?.district,
    };
  }

  // 6️⃣ Save buyer
  const updatedUser = await user.save();

  // 7️⃣ Notification (BELLS only)
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers") || {};

  const notif = await Notification.create({
    title: "👤 Profile Updated",
    message: "Your profile information has been updated successfully.",
    data: {
      userId: updatedUser._id,
      name: updatedUser.name,
      mobileNumber: updatedUser.mobileNumber,
      action: "profile_updated",
    },
    receiverId: updatedUser._id,
    userType: "Buyer",
    createdBy: updatedUser._id,
    isRead: false,
  });

  if (onlineUsers[updatedUser._id]) {
    io.to(onlineUsers[updatedUser._id].socketId).emit("notification", notif);
  }

  // 8️⃣ Final Response
  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    data: {
      id: updatedUser.id,
      name: updatedUser.name,
      mobileNumber: updatedUser.mobileNumber,
      profilePicture: updatedUser.profilePicture,
      address: updatedUser.address,
    },
  });
});







const updateBuyerLocation = asyncHandler(async (req, res) => {
  try {
    let {
      pinCode,
      houseNumber,
      locality,
      city,
      district,
      latitude,
      longitude
    } = req.body;

    let locationData = null;

    // --- 1️⃣ Handle Geo Coordinates ---
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid latitude or longitude provided.'
        });
      }

      // --- 2️⃣ Reverse Geocode (optional auto-fill) ---
      try {
        const geoResponse = await axios.get(
          `https://nominatim.openstreetmap.org/reverse`,
          {
            params: {
              lat,
              lon: lng,
              format: 'json',
              addressdetails: 1
            },
            headers: { 'User-Agent': 'ViaFarm/1.0 (viafarm.app)' }
          }
        );

        const addr = geoResponse.data.address;
        if (addr) {
          pinCode = pinCode || addr.postcode || '';
          city = city || addr.city || addr.town || addr.village || '';
          district = district || addr.state_district || addr.county || '';
          locality =
            locality ||
            addr.suburb ||
            addr.neighbourhood ||
            addr.road ||
            addr.hamlet ||
            '';
        }
      } catch (geoErr) {
        console.warn('⚠️ Reverse geocoding failed:', geoErr.message);
      }

      locationData = {
        type: 'Point',
        coordinates: [lng, lat]
      };
    }

    // --- 3️⃣ Build Update Object ---
    const updateFields = {};

    if (pinCode) updateFields['address.pinCode'] = pinCode;
    if (houseNumber) updateFields['address.houseNumber'] = houseNumber;
    if (locality) updateFields['address.locality'] = locality;
    if (city) updateFields['address.city'] = city;
    if (district) updateFields['address.district'] = district;
    if (locationData) updateFields['location'] = locationData;

    // --- 4️⃣ Skip if nothing provided ---
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided for update.'
      });
    }

    // --- 5️⃣ Update User ---
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('address location');

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    // --- 6️⃣ Response ---
    res.status(200).json({
      success: true,
      message: 'Location updated successfully.',
      data: updatedUser
    });
  } catch (error) {
    console.error('❌ Error updating buyer location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating location.',
      error: error.message
    });
  }
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

    res.json({ success: true, message: 'Logged out successfully' });
});


const getAddresses = asyncHandler(async (req, res) => {
  // 1️⃣ Fetch all addresses for this user
  const addresses = await Address.find({ user: req.user._id })
    .select("-name -mobileNumber") // exclude unnecessary fields
    .lean();

  // 2️⃣ If no addresses found
  if (!addresses || addresses.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No addresses found.",
      addresses: []
    });
  }

  // 3️⃣ Format response
  const formattedAddresses = addresses.map(addr => {
    const formattedAddress = [
      addr.houseNumber,
      addr.street,
      addr.locality,
      addr.city,
      addr.district,
      addr.state,
      addr.pinCode
    ]
      .filter(Boolean)
      .join(", ");

    return {
      id: addr._id.toString(),
      isDefault: addr.isDefault,
      formattedAddress,
      pinCode: addr.pinCode,
      houseNumber: addr.houseNumber,
      street: addr.street || "",
      locality: addr.locality || "",
      city: addr.city || "",
      district: addr.district || "",
      state: addr.state || "",
      location: addr.location || { type: "Point", coordinates: [] },
      createdAt: addr.createdAt,
      updatedAt: addr.updatedAt
    };
  });

  // 4️⃣ Send response
  res.status(200).json({
    success: true,
    message: "All addresses retrieved successfully.",
    addresses: formattedAddresses
  });
});






// Helper: Convert address → coordinates using OpenStreetMap
async function geocodeAddress({ houseNumber, street, locality, city, district, state, pinCode }) {
  try {
    const fullAddress = [houseNumber, street, locality, city, district, state, pinCode]
      .filter(Boolean)
      .join(", ");

    if (!fullAddress) return null;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&limit=1`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "ViaFarm/1.0 (viafarm.app)" },
    });

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (!isNaN(lat) && !isNaN(lon)) return [lon, lat];
    }
    return null;
  } catch (err) {
    console.warn("⚠️ Geocoding failed:", err.message);
    return null;
  }
}

async function geocodeAddress(addr) {
  const fullAddress = [
    addr.houseNumber,
    addr.street,
    addr.locality,
    addr.city,
    addr.district,
    addr.state,
    addr.pinCode
  ]
    .filter(Boolean)
    .join(", ");

  if (!fullAddress) return null;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    fullAddress
  )}&format=json&limit=1`;

  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "viafarm-app" },
    });

    if (!res.data.length) return null;

    return [
      parseFloat(res.data[0].lon), // X
      parseFloat(res.data[0].lat)  // Y
    ];
  } catch (err) {
    console.log("❌ Geocoding failed:", err.message);
    return null;
  }
}

const addAddress = asyncHandler(async (req, res) => {
  try {
    let {
      pinCode,
      houseNumber,
      street,
      locality,
      city,
      district,
      state,
      isDefault,
      latitude,
      longitude,
    } = req.body;

    if (!houseNumber) {
      return res.status(400).json({
        success: false,
        message: "House number is required.",
      });
    }

    let geoJsonLocation = null;

    /** ✅ 1. Use direct coordinates if provided */
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      ) {
        geoJsonLocation = {
          type: "Point",
          coordinates: [lng, lat],
        };
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid latitude or longitude.",
        });
      }
    } else {
      /** 🌍 2. Auto-GeoCoding if lat/lng missing */
      const coords = await geocodeAddress({
        houseNumber,
        street,
        locality,
        city,
        district,
        state,
        pinCode,
      });

      if (coords) {
        geoJsonLocation = {
          type: "Point",
          coordinates: coords,
        };
        console.log("📍 Auto-Geocoded:", coords);
      } else {
        console.log("⚠ Geocoding failed → saving without coordinates");
      }
    }

    /** ⭐ 3. Default Address Logic */
    const existing = await Address.find({ user: req.user._id });
    let makeDefault = isDefault;

    if (existing.length === 0) {
      makeDefault = true; // first address is always default
    }

    if (makeDefault) {
      await Address.updateMany(
        { user: req.user._id, isDefault: true },
        { isDefault: false }
      );
    }

    /** 🏠 4. Create Address */
    const newAddress = await Address.create({
      user: req.user._id,
      pinCode: pinCode || "",
      houseNumber,
      street: street || "",
      locality: locality || "",
      city: city || "",
      district: district || "",
      state: state || "",
      isDefault: makeDefault,
      location: geoJsonLocation, // 🌍 Saved correctly
    });

    /** 🧩 Build formattedAddress */
    const formattedAddress = [
      newAddress.houseNumber,
      newAddress.street,
      newAddress.locality,
      newAddress.city,
      newAddress.district,
      newAddress.state,
      newAddress.pinCode,
    ]
      .filter(Boolean)
      .join(", ");

    return res.status(201).json({
      success: true,
      message: "Address added successfully.",
      address: {
        id: newAddress._id,
        user: newAddress.user,
        formattedAddress,
        isDefault: newAddress.isDefault,
        coordinates: newAddress.location?.coordinates || [],
        details: {
          houseNumber: newAddress.houseNumber,
          street: newAddress.street,
          locality: newAddress.locality,
          city: newAddress.city,
          district: newAddress.district,
          state: newAddress.state,
          pinCode: newAddress.pinCode,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error adding address:", error);
    res.status(500).json({
      success: false,
      message: "Server error while adding address.",
      error: error.message,
    });
  }
});




async function geocodeAddress(addr) {
  const full = [
    addr.houseNumber,
    addr.street,
    addr.locality,
    addr.city,
    addr.district,
    addr.state,
    addr.pinCode,
  ]
    .filter(Boolean)
    .join(", ");

  if (!full) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      full
    )}&format=json&limit=1`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "ViaFarm-GeoCoder" },
    });

    if (!data.length) return null;

    return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  } catch (err) {
    console.log("❌ Geocode error:", err.message);
    return null;
  }
}

const updateAddress = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    let {
      pinCode,
      houseNumber,
      street,
      locality,
      city,
      district,
      state,
      isDefault,
      latitude,
      longitude,
    } = req.body;

    // --- 1️⃣ Validate ID ---
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address ID.",
      });
    }

    // --- 2️⃣ Find the address ---
    const address = await Address.findOne({ _id: id, user: req.user._id });
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found.",
      });
    }

    let newCoordinates = null;

    // --- 3️⃣ If coordinates provided → update + reverse-geocode missing fields ---
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid latitude or longitude.",
        });
      }

      newCoordinates = [lng, lat];

      address.location = {
        type: "Point",
        coordinates: newCoordinates,
      };

      // 🌍 Reverse Geocode → fill missing details
      try {
        const resp = await axios.get(
          "https://nominatim.openstreetmap.org/reverse",
          {
            params: { lat, lon: lng, format: "json", addressdetails: 1 },
            headers: { "User-Agent": "ViaFarm-GeoCoder" },
          }
        );

        const addr = resp.data.address || {};
        pinCode = pinCode || addr.postcode || "";
        city = city || addr.city || addr.town || addr.village || "";
        district = district || addr.state_district || addr.county || "";
        state = state || addr.state || "";
        locality =
          locality ||
          addr.suburb ||
          addr.road ||
          addr.neighbourhood ||
          addr.hamlet ||
          "";
      } catch (err) {
        console.log("⚠ Reverse geocode failed:", err.message);
      }
    }

    // --- 4️⃣ If NO coordinates provided → Forward-Geocode ---
    else {
      const coords = await geocodeAddress({
        houseNumber,
        street,
        locality,
        city,
        district,
        state,
        pinCode,
      });

      if (coords) {
        address.location = { type: "Point", coordinates: coords };
        newCoordinates = coords;
        console.log("📍 Auto-coordinates:", coords);
      } else {
        console.log("⚠ Could not geocode updated address.");
      }
    }

    // --- 5️⃣ Make default address ---
    if (isDefault === true) {
      await Address.updateMany(
        { user: req.user._id, isDefault: true },
        { isDefault: false }
      );
      address.isDefault = true;
    }

    // --- 6️⃣ Apply partial updates safely ---
    if (pinCode !== undefined) address.pinCode = pinCode;
    if (houseNumber !== undefined) address.houseNumber = houseNumber;
    if (street !== undefined) address.street = street || "";
    if (locality !== undefined) address.locality = locality;
    if (city !== undefined) address.city = city;
    if (district !== undefined) address.district = district;
    if (state !== undefined) address.state = state;

    // --- 7️⃣ Save ---
    await address.save();

    // --- 8️⃣ Build formatted address ---
    const formattedAddress = [
      address.houseNumber,
      address.street,
      address.locality,
      address.city,
      address.district,
      address.state,
      address.pinCode,
    ]
      .filter(Boolean)
      .join(", ");

    return res.json({
      success: true,
      message: "Address updated successfully.",
      address: {
        id: address._id,
        formattedAddress,
        isDefault: address.isDefault,
        coordinates: address.location?.coordinates || [],
        details: {
          houseNumber: address.houseNumber,
          street: address.street,
          locality: address.locality,
          city: address.city,
          district: address.district,
          state: address.state,
          pinCode: address.pinCode,
        },
      },
    });
  } catch (error) {
    console.error("❌ updateAddress error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update address",
      error: error.message,
    });
  }
});





const deleteAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1️⃣ Validate ObjectId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid address ID.",
    });
  }

  // 2️⃣ Check address exists for this user
  const address = await Address.findOne({
    _id: id,
    user: req.user._id,
  });

  if (!address) {
    return res.status(404).json({
      success: false,
      message: "Address not found.",
    });
  }

  const wasDefault = address.isDefault;

  // 3️⃣ Delete address
  await address.deleteOne();

  let newDefaultAddress = null;

  // 4️⃣ If deleted address was default → assign NEW default
  if (wasDefault) {
    // find latest added address
    newDefaultAddress = await Address.findOne({ user: req.user._id })
      .sort({ createdAt: -1 });

    if (newDefaultAddress) {
      newDefaultAddress.isDefault = true;
      await newDefaultAddress.save();
    }
  }

  // 5️⃣ Count remaining addresses
  const remainingCount = await Address.countDocuments({
    user: req.user._id,
  });

  return res.status(200).json({
    success: true,
    message: "Address deleted successfully.",
    deletedAddressId: id,
    newDefaultAddressId: newDefaultAddress?._id || null,
    remainingAddresses: remainingCount,
  });
});






const setDefaultAddress = asyncHandler(async (req, res) => {
    await Address.updateMany({ user: req.user._id }, { isDefault: false });
    const address = await Address.findByIdAndUpdate(req.params.id, { isDefault: true }, { new: true });
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Default address set', data: address });
});



const selectPickupSlot = asyncHandler(async (req, res) => {
    const { vendorId, date, startTime, endTime } = req.body;
    const userId = req.user._id;

    if (!vendorId || !date || !startTime || !endTime) {
        return res.status(400).json({ success: false, message: "All slot fields are required." });
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
        return res.status(404).json({ success: false, message: "Cart not found." });
    }

    // FIX: Ensure vendorId is a valid ObjectId before saving.
    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        return res.status(400).json({ success: false, message: "Invalid vendor ID." });
    }

    // Save the pickup details with the vendorId as an ObjectId
    cart.pickupDetails = {
        vendor: new mongoose.Types.ObjectId(vendorId), // <-- CAST TO OBJECTID HERE
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



const getPickupLocationDetails = asyncHandler(async (req, res) => {
    const { vendorId } = req.params;
    const userId = req.user._id;

    // Fetch vendor, cart, and buyer's default address in parallel
    const [vendor, cart, defaultBuyerAddress] = await Promise.all([
        User.findById(vendorId)
            .select("name mobileNumber address location profilePicture role")
            .lean(),
        Cart.findOne({ user: userId }).select("pickupDetails").lean(),
        Address.findOne({ user: userId, isDefault: true }).lean()
    ]);

    let buyerAddress = defaultBuyerAddress || (await Address.findOne({ user: userId }).lean());

    if (!vendor || vendor.role !== "Vendor") {
        return res.status(404).json({ success: false, message: "Vendor not found." });
    }

    // Determine slot details
    let slotToDisplay = {};
    let isSaved = false;
    const savedPickup = cart?.pickupDetails;
    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);

    if (savedPickup && savedPickup.vendor?.equals(vendorObjectId)) {
        // Use selected slot
        slotToDisplay = savedPickup;
        isSaved = true;
    } else {
        // Fallback default slot (optional)
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);

        const formattedDate = `${String(tomorrow.getDate()).padStart(2, "0")}/${String(tomorrow.getMonth() + 1).padStart(2, "0")
            }/${tomorrow.getFullYear()}`;

        slotToDisplay = {
            date: formattedDate,
            startTime: "10:30 AM",
            endTime: "12:30 PM",
        };
        isSaved = false;
    }

    // Calculate distance
    let distanceKm = null;
    if (buyerAddress?.location?.coordinates?.length === 2 && vendor.location?.coordinates?.length === 2) {
        const [vendorLng, vendorLat] = vendor.location.coordinates;
        const buyerLatNum = buyerAddress.location.coordinates[1];
        const buyerLngNum = buyerAddress.location.coordinates[0];
        distanceKm = calculateDistance(buyerLatNum, buyerLngNum, vendorLat, vendorLng).toFixed(1);
    }

    // Format vendor address
    const vendorAddressText = [
        vendor.address?.houseNumber,
        vendor.address?.locality || vendor.address?.city,
        vendor.address?.city
    ].filter(Boolean).join(", ");

    const pickupHoursDisplay = `${slotToDisplay.startTime} to ${slotToDisplay.endTime}`;

    res.status(200).json({
        success: true,
        data: {
            vendor: {
                name: vendor.name,
                profilePicture: vendor.profilePicture,
                phoneNo: vendor.mobileNumber,
                pickupLocationText: vendorAddressText,
                distance: distanceKm ? `${distanceKm} kms away` : "N/A",
            },
            slotDetails: {
                date: slotToDisplay.date,
                startTime: slotToDisplay.startTime,
                endTime: slotToDisplay.endTime,
                pickupHoursDisplay,
                isSaved
            }
        }
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



const searchAllProducts = asyncHandler(async (req, res) => {
    const { q, lat, lng, category, page = 1, limit = 10 } = req.query;
    const userId = req.user._id;

    const pageSize = parseInt(limit);
    const skip = (parseInt(page) - 1) * pageSize;

    // Base query: Only 'In Stock' products
    const query = { status: 'In Stock' };

    // 1️⃣ Search filter
    if (q) {
        query.name = { $regex: q, $options: 'i' };
    }

    // 2️⃣ Category filter
    if (category) {
        query.category = category;
    }

    // 3️⃣ Determine buyer location
    let buyerLocation = null;
    if (lat && lng) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        if (!isNaN(userLat) && !isNaN(userLng)) {
            buyerLocation = { lat: userLat, lng: userLng };
        }
    } else {
        // Fallback: use user profile location
        const buyer = await User.findById(userId).select('location');
        if (buyer?.location?.coordinates?.length === 2) {
            buyerLocation = {
                lat: buyer.location.coordinates[1],
                lng: buyer.location.coordinates[0]
            };
        }
    }

    // 4️⃣ Fetch total products count
    const totalProducts = await Product.countDocuments(query);

    // 5️⃣ Fetch products with vendor info
    const products = await Product.find(query)
        .select('name price unit images weightPerPiece rating vendor variety')
        .limit(pageSize)
        .skip(skip)
        .populate('vendor', 'name location');

    // 6️⃣ Format products
    const formattedProducts = products.map(product => {
        let distanceText = 'N/A';
        const vendor = product.vendor;

        if (buyerLocation && vendor?.location?.coordinates?.length === 2) {
            const [vendorLng, vendorLat] = vendor.location.coordinates;
            const distance = calculateDistance(
                buyerLocation.lat,
                buyerLocation.lng,
                vendorLat,
                vendorLng
            ).toFixed(1);
            distanceText = `${distance} kms away`;
        }

        return {
            id: product._id,
            name: product.name,
            rating: product.rating || 0,
            vendorName: vendor?.name || 'Unknown Vendor',
            distance: distanceText,
            weightPerPiece: product.weightPerPiece,
            price: `₹ ${product.price} / ${product.unit}`,
            imageUrl: product.images?.[0] || 'https://default-image.url',
            unitDisplay: product.variety || product.unit || '1pc'
        };
    });

    // 7️⃣ Send response
    res.status(200).json({
        success: true,
        count: formattedProducts.length,
        total: totalProducts,
        page: parseInt(page),
        pages: Math.ceil(totalProducts / pageSize),
        products: formattedProducts
    });
});



const getVendorsByProductName = asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 10, lat, lng } = req.query;

    if (!q || q.trim() === '') {
        return res.status(400).json({ success: false, message: 'Search query (q) is required.' });
    }

    const pageSize = parseInt(limit);
    const skip = (parseInt(page) - 1) * pageSize;

    // 1️⃣ Find all products matching the query
    const matchingProducts = await Product.find({
        name: { $regex: q, $options: 'i' },
        status: 'In Stock'
    }).select('vendor');

    if (matchingProducts.length === 0) {
        return res.status(404).json({ success: false, message: `No active products found matching "${q}".` });
    }

    // 2️⃣ Extract unique vendor IDs
    const uniqueVendorIds = [...new Set(matchingProducts.map(p => p.vendor.toString()))];
    const vendorObjectIds = uniqueVendorIds.map(id => new mongoose.Types.ObjectId(id));
    const totalVendors = vendorObjectIds.length;

    // 3️⃣ Fetch Vendors (paginated)
    const vendors = await User.find({
        _id: { $in: vendorObjectIds },
        role: 'Vendor',
        status: 'Active'
    })
        .select('name profilePicture mobileNumber address rating location')
        .limit(pageSize)
        .skip(skip)
        .sort({ rating: -1, name: 1 });

    // 4️⃣ Format Vendors
    const formattedVendors = await Promise.all(vendors.map(async vendor => {
        // Distance calculation
        let distanceText = 'N/A';
        if (lat && lng && vendor?.location?.coordinates?.length === 2) {
            const [vendorLng, vendorLat] = vendor.location.coordinates;
            const distance = calculateDistance(
                parseFloat(lat),
                parseFloat(lng),
                vendorLat,
                vendorLng
            ).toFixed(1);
            distanceText = `${distance} kms away`;
        }

        // Count categories sold by this vendor
        const categories = await Product.distinct('category', { vendor: vendor._id, status: 'In Stock' });

        // Count products matching search query for this vendor
        const productsSoldCount = matchingProducts.filter(p => p.vendor.toString() === vendor._id.toString()).length;

        return {
            id: vendor._id,
            name: vendor.name,
            profilePicture: vendor.profilePicture || 'https://default-image-url.com/default.png',
            mobileNumber: vendor.mobileNumber,
            rating: vendor.rating || 0,
            distance: distanceText,
            categoriesSold: categories.join(', '),
            productsSoldCount
        };
    }));

    res.status(200).json({
        success: true,
        message: `Found ${totalVendors} vendor(s) selling products related to "${q}".`,
        count: formattedVendors.length,
        total: totalVendors,
        page: parseInt(page),
        pages: Math.ceil(totalVendors / pageSize),
        vendors: formattedVendors
    });
});


const getProductsByName = asyncHandler(async (req, res) => {
    const {
        q,
        lat,
        lng,
        page = 1,
        limit = 10
    } = req.query;

    const userId = req.user._id;
    const pageSize = parseInt(limit);
    const skip = (parseInt(page) - 1) * pageSize;

    if (!q || q.trim() === '') {
        return res.status(400).json({ success: false, message: 'Search query (q) is required to find products.' });
    }

    // 1. Prepare Query
    const query = {
        name: { $regex: q, $options: 'i' }, // Case-insensitive search on product name
        status: 'In Stock'
    };

    // 2. Fetch Buyer Location (Needed for distance calculation)
    let buyerLocation = null;
    if (lat && lng) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        if (!isNaN(userLat) && !isNaN(userLng)) {
            buyerLocation = { lat: userLat, lng: userLng };
        }
    } else {
        // Fallback: Fetch from user profile if not provided in query
        const buyer = await User.findById(userId).select('location');
        if (buyer?.location?.coordinates?.length === 2) {
            buyerLocation = { lat: buyer.location.coordinates[1], lng: buyer.location.coordinates[0] };
        }
    }

    // 3. Execute Query (Products + Count)
    const totalProducts = await Product.countDocuments(query);

    const products = await Product.find(query)
        .select('name price unit weightPerPiece images rating vendor variety')
        .limit(pageSize)
        .skip(skip)
        .populate('vendor', 'name location'); // Populate vendor name and location for distance/display

    if (products.length === 0) {
        return res.status(404).json({ success: false, message: `No active products found matching "${q}".` });
    }

    // 4. Format Output (Matching the image card structure)
    const formattedProducts = products.map(product => {
        let distanceText = 'N/A';
        const vendor = product.vendor;

        // Calculate Distance if possible
        if (buyerLocation && vendor?.location?.coordinates?.length === 2) {
            const [vendorLng, vendorLat] = vendor.location.coordinates;

            const distance = calculateDistance(
                buyerLocation.lat,
                buyerLocation.lng,
                vendorLat,
                vendorLng
            ).toFixed(1);

            distanceText = `${distance} kms away`;
        }

        // Final structure matching the image:
        return {
            id: product._id,
            name: product.name, // e.g., Mango Chausa
            rating: product.rating || 0, // e.g., 4.5
            vendorName: vendor?.name || 'Unknown Vendor', // e.g., by Ashok Sharma
            distance: distanceText, // e.g., 1.2 kms away
            // Custom price/unit format matching the UI: ₹200 / 1pc 100gm
            priceDisplay: `₹ ${product.price} / ${product.unit || 'pc'} 100gm`,
            imageUrl: product.images?.[0] || 'https://default-image.url',
            // Raw data for quantity control/cart management
            price: product.price,
            unit: product.unit,
            weightPerPiece: product.weightPerPiece,
            vendorId: product.vendor?._id
        };
    });

    res.status(200).json({
        success: true,
        count: formattedProducts.length,
        total: totalProducts,
        page: parseInt(page),
        pages: Math.ceil(totalProducts / pageSize),
        products: formattedProducts
    });
});


const getProductsByVendorId = asyncHandler(async (req, res) => {
    const { vendorId } = req.params;
    const { page = 1, limit = 12 } = req.query;

    // 1️⃣ Validate Vendor ID
    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        return res.status(400).json({ success: false, message: 'Invalid vendor ID.' });
    }

    const pageSize = parseInt(limit);
    const skip = (parseInt(page) - 1) * pageSize;

    // 2️⃣ Define Query: Only 'In Stock' products from this vendor
    const query = { vendor: vendorId, status: 'In Stock' };

    // 3️⃣ Count total products
    const totalProducts = await Product.countDocuments(query);

    // 4️⃣ Fetch paginated products
    const products = await Product.find(query)
        .select('name variety price weightPerPiece rating unit images') // fields to return
        .limit(pageSize)
        .skip(skip)
        .sort({ rating: -1, name: 1 });

    if (products.length === 0 && parseInt(page) === 1) {
        return res.status(404).json({
            success: false,
            message: 'This vendor has no active products listed.'
        });
    }

    // 5️⃣ Format response
    const formattedProducts = products.map(p => ({
        id: p._id,
        name: p.name,
        variety: p.variety || 'N/A',
        price: p.price,
        rating: p.rating || 0,
        unit: p.unit || 'pc',
        weightPerPiece: p.weightPerPiece,
        imageUrl: p.images?.[0] || null,
        vendorId
    }));

    res.status(200).json({
        success: true,
        count: formattedProducts.length,
        total: totalProducts,
        page: parseInt(page),
        pages: Math.ceil(totalProducts / pageSize),
        products: formattedProducts
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

const donateToAdmin = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { amount, message = "", paymentMethod = "UPI" } = req.body;

    // 1️⃣ Validate amount
    if (!amount || amount <= 0) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid donation amount.",
        });
    }

    // 2️⃣ Find Admin
    const admin = await User.findOne({ role: "Admin" }).select("name upiId expoPushToken");
    if (!admin) {
        return res.status(404).json({ success: false, message: "Admin not found." });
    }

    // 3️⃣ Ensure admin UPI
    if (!admin.upiId && paymentMethod === "UPI") {
        return res.status(400).json({
            success: false,
            message: "Admin has not configured a UPI ID for donations.",
        });
    }

    // 4️⃣ Prepare UPI payment
    const transactionRef = `DONATE-${Date.now()}`;
    const isOnline = paymentMethod === "UPI";
    let upiUrl = null;
    let qrCode = null;

    if (isOnline) {
        upiUrl = `upi://pay?pa=${encodeURIComponent(admin.upiId)}&pn=${encodeURIComponent(
            admin.name
        )}&am=${amount.toFixed(2)}&tn=${encodeURIComponent("Donation to Admin")}&tr=${encodeURIComponent(
            transactionRef
        )}&cu=INR`;

        qrCode = await QRCode.toDataURL(upiUrl);
    }

    // 5️⃣ Create donation record
    const donation = await Donation.create({
        donor: userId,
        admin: admin._id,
        amount,
        message,
        paymentMethod,
        transactionRef,
        upiUrl,
        qrCode,
        status: isOnline ? "Pending" : "Completed",
    });

    // Socket + Users
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers") || {};

    // ----------------------------------------------------
    // 6️⃣ Notifications (Custom Logic)
    // ----------------------------------------------------

    // 🟢 BUYER (Bell Only)
    const buyerNotification = await Notification.create({
        title: "🎁 Donation Created",
        message: `Your donation of ₹${amount.toFixed(2)} has been initiated successfully.`,
        receiverId: userId,
        userType: "Buyer",
        createdBy: userId,
        isRead: false,
        data: {
            donationId: donation._id,
            amount,
            paymentMethod,
            transactionRef
        }
    });

    // Real-time bell notification (buyer)
    if (onlineUsers[userId]) {
        io.to(onlineUsers[userId].socketId).emit("notification", buyerNotification);
    }

    // 🟡 ADMIN (Bell Only)
    const adminNotification = await Notification.create({
        title: "💰 New Donation Received",
        message: `You have received a donation of ₹${amount.toFixed(2)} from ${req.user.name || "a user"}.`,
        receiverId: admin._id,
        userType: "Admin",
        createdBy: userId,
        isRead: false,
        data: {
            donationId: donation._id,
            donorId: userId,
            amount,
            paymentMethod,
            transactionRef
        }
    });

    // Real-time bell notification (admin)
    if (onlineUsers[admin._id]) {
        io.to(onlineUsers[admin._id].socketId).emit("notification", adminNotification);
    }

    // 🟣 Vendor logic (future)
    // If donation system expands and vendor involved, then:
    // Send BOTH Bell + Push to vendor
    // (Right now donation does not involve vendor, so skipped)

    // ----------------------------------------------------

    // 7️⃣ Response
    res.status(201).json({
        success: true,
        message: isOnline
            ? "Donation created successfully. Please complete the UPI payment."
            : "Cash donation recorded successfully.",
        donationId: donation._id,
        paymentMethod,
        amount: amount.toFixed(2),
        adminName: admin.name,
        upiId: admin.upiId || null,
        upiUrl,
        qrCode,
        transactionRef,
    });
});




const getDonationsReceived = asyncHandler(async (req, res) => {
    const { page = 1, limit = 12, sortBy = 'createdAt', sortOrder = -1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: parseInt(sortOrder) };

    try {
        // Fetch donations with donor info
        const donations = await Donation.find()
            .select('donor admin amount message paymentMethod transactionRef status createdAt')
            .populate('donor', 'name email') // donor details
            .populate('admin', 'name email') // admin details
            .sort(sort)
            .limit(parseInt(limit))
            .skip(skip)
            .lean();

        const totalCount = await Donation.countDocuments();

        // Format for frontend
        const formattedDonations = donations.map(d => ({
            donorName: d.donor?.name || 'Anonymous',
            donorEmail: d.donor?.email || '',
            adminName: d.admin?.name || 'Admin',
            amount: d.amount,
            paymentMethod: d.paymentMethod,
            message: d.message,
            status: d.status,
            transactionRef: d.transactionRef,
            date: new Date(d.createdAt).toLocaleDateString('en-GB'),
        }));

        res.status(200).json({
            success: true,
            totalCount,
            resultsPerPage: parseInt(limit),
            currentPage: parseInt(page),
            donations: formattedDonations,
        });
    } catch (error) {
        console.error("Error fetching donations:", error);
        res.status(500).json({ success: false, message: 'Failed to retrieve donation data.' });
    }
});
const searchProductsByName = asyncHandler(async (req, res) => {
  const { name } = req.query;
  const buyerId = req.user?._id;

  // ✅ Get buyer default address (location)
  let buyerLat = null, buyerLng = null;
  const buyerAddress = await Address.findOne({ user: buyerId, isDefault: true }).lean();
  if (buyerAddress?.location?.coordinates?.length === 2) {
    buyerLng = buyerAddress.location.coordinates[0];
    buyerLat = buyerAddress.location.coordinates[1];
  }

  let query = {};

  if (name?.trim()) {
    const text = name.trim();

    // ✅ Vendors matching name
    const vendors = await User.find({
      role: "Vendor",
      name: { $regex: text, $options: "i" }
    }).select("_id");

    const vendorIds = vendors.map((v) => v._id);

    query.$or = [
      { name: { $regex: text, $options: "i" } },        // Product Name
      { category: { $regex: text, $options: "i" } },    // Category Name
      { vendor: { $in: vendorIds } }                    // Vendor Name
    ];
  }

  const products = await Product.find(query)
    .populate("vendor", "name profilePicture mobileNumber location address")
    .lean();

  // ✅ Add distance to each product
  const data = products.map((p) => {
    let distanceInKm = null;
    let distanceText = null;

    // Ensure vendor has location
    if (
      buyerLat && buyerLng &&
      p.vendor?.location?.coordinates?.length === 2
    ) {
      const vendorLng = p.vendor.location.coordinates[0];
      const vendorLat = p.vendor.location.coordinates[1];

      const toRad = (v) => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(vendorLat - buyerLat);
      const dLon = toRad(vendorLng - buyerLng);

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(buyerLat)) *
          Math.cos(toRad(vendorLat)) *
          Math.sin(dLon / 2) ** 2;

      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distanceInKm = Number(dist.toFixed(2));
      distanceText = `${distanceInKm} km away`;
    }

    return {
      ...p,
      distanceInKm,
      distanceText,
    };
  });

  // ✅ Sort nearest vendors first if buyer location available
  if (buyerLat && buyerLng) {
    data.sort((a, b) => (a.distanceInKm ?? Infinity) - (b.distanceInKm ?? Infinity));
  }

  return res.status(200).json({
    success: true,
    count: data.length,
    data
  });
});




const markOrderPaid = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { orderId } = req.params;

    // 🔍 1️⃣ Find order (ensure buyer matches)
    const order = await Order.findOne({ _id: orderId, buyer: userId })
        .populate("vendor buyer", "name email");

    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
    }

    // 🚫 Already paid
    if (order.isPaid) {
        return res
            .status(400)
            .json({ success: false, message: "Order already marked as paid." });
    }

    // ✅ 2️⃣ Update order payment info
    order.isPaid = true;
    order.orderStatus = "Confirmed";
    await order.save();

    // 🔔 3️⃣ Send Notifications

    // 🧍‍♂️ Notify Buyer (Personal)
    await createAndSendNotification(
        req,
        "💳 Payment Successful",
        `Your payment for order ${order.orderId || order._id} has been confirmed successfully.`,
        {
            orderId: order._id,
            amount: order.totalPrice,
            status: order.orderStatus,
        },
        "Buyer",
        order.buyer._id // 🎯 personal buyer
    );

    // 🧑‍🌾 Notify Vendor (Personal)
    await createAndSendNotification(
        req,
        "🛍️ New Paid Order",
        `${order.buyer.name || "A buyer"} has completed payment for order ${order.orderId || order._id}.`,
        {
            orderId: order._id,
            buyerId: order.buyer._id,
            buyerName: order.buyer.name,
            totalPrice: order.totalPrice,
        },
        "Vendor",
        order.vendor._id // 🎯 personal vendor
    );

    // ✅ 4️⃣ Send Response
    res.status(200).json({
        success: true,
        message: "Payment confirmed successfully. Notifications sent to buyer and vendor.",
    });
});




module.exports = {
    getHomePageData, getProductsByVendorId, donateToAdmin, getDonationsReceived, searchProductsByName,
    getProductDetails, markOrderPaid,setDeliveryType,reviewOrder,
    getFilteredProducts,
    getVendorsNearYou,
    getCartItems,
    addItemToCart,
    removeItemFromCart,
    updateCartItemQuantity,
    placeOrder,saveDeliveryAddress,
    getBuyerOrders,
    getWishlist,
    addToWishlist,getCategoriesWithProducts,
    removeFromWishlist, searchAllProducts,
    reorder,
    getBuyerProfile,placePickupOrder,
    updateBuyerProfile,
    logout,getFreshAndPopularVendors,
    getOrderDetails,getProductsByVariety ,
    setDefaultAddress, deleteAddress, getProductById,
    updateBuyerLocation, addToWishlist, getAllVendors, getVendorsByProductName, getProductsByName, updateAddress,
    updateBuyerLanguage, getHighlightedCoupon, getPickupLocationDetails, getPickupLocationDetailsPost, selectPickupSlot,
    writeReview, getProductsByCategory, getVendorProfileForBuyer, getProductReviews, getAvailableCouponsForBuyer,
    getBuyerOrders, getLocalBestProducts, getAllAroundIndiaProducts, getSmartPicks, getCouponsByProductId,
    getOrderDetails, searchProducts, getFreshAndPopularProducts, generateUpiPaymentUrl,
    getReviewsForProduct, updateReview, deleteReview, applyCouponToCart, startCheckout, verifyPayment, addAddress, getAddresses, getStaticPageContent
};
