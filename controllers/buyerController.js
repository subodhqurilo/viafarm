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
const Donation = require('../models/Donation');
const QRCode = require('qrcode');
const PickupLocation = require('../models/PickupLocation');
const { createAndSendNotification } = require('../utils/notificationUtils');

// -----------------------------
// Home & Product Discovery
// -----------------------------

// @desc    Get buyer home screen data
// @route   GET /api/buyer/home
// @access  Private/Buyer

// Add this at the top or above your controller function

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(2); // round to 2 decimals
}



const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    // Haversine formula
    const R = 6371; // km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const calculateEstimatedDelivery = (vendor, buyer, orderTime = new Date()) => {
  let deliveryDate = new Date(orderTime);

  // Safe coordinate extraction
  const vendorCoords = vendor?.location?.coordinates || [0, 0]; // [lng, lat]
  const buyerCoords = buyer?.location?.coordinates || [0, 0];

  const vendorLat = vendorCoords[1];
  const vendorLng = vendorCoords[0];
  const buyerLat = buyerCoords[1];
  const buyerLng = buyerCoords[0];

  const distanceKm = calculateDistanceKm(vendorLat, vendorLng, buyerLat, buyerLng);

  // Buyer within vendor delivery region
  if (distanceKm <= (vendor?.deliveryRegion || 0)) {
    const cutoffHour = 17; // 5 PM
    if (orderTime.getHours() >= cutoffHour) {
      deliveryDate.setDate(deliveryDate.getDate() + 1);
    }
  } else {
    // Buyer out of delivery region
    let daysToAdd = 4; // default for different state
    if (vendor?.address?.state && buyer?.address?.state && vendor.address.state === buyer.address.state) {
      daysToAdd = 2 + Math.floor(Math.random() * 2); // 2-3 days
    }
    deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
  }

  // Format delivery date
  const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
  const formattedDate = deliveryDate.toLocaleDateString('en-US', options);

  return {
    formatted: formattedDate,
    date: deliveryDate.toISOString(),
    distanceKm: distanceKm.toFixed(1)
  };
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
        .populate('vendor', 'name address mobileNumber weightPerPiece rating location profilePicture');

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
                location: product.vendor.location || {} ,// coordinates and type
                profilePicture: product.vendor.profilePicture,
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

  const products = await Product.find({ status: 'In Stock' })
    .populate('vendor', 'name location')
    .sort({ rating: -1, createdAt: -1 })
    .limit(10);

  const enriched = products.map((p) => {
    let distanceText = 'N/A';
    if (p.vendor?.location?.coordinates && buyer?.location?.coordinates) {
      const [vendorLng, vendorLat] = p.vendor.location.coordinates;
      const [buyerLng, buyerLat] = buyer.location.coordinates;

      const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);

      if (!isNaN(distance)) {
        distanceText = `${distance.toFixed(2)} km away`;
      }
    }

    return {
      ...p.toObject(),
      distance: distanceText,
    };
  });

  res.status(200).json({
    success: true,
    count: enriched.length,
    data: enriched,
  });
});




const getLocalBestProducts = asyncHandler(async (req, res) => {
  const { lat, lng, maxDistance = 50000 } = req.query; // default: 50 km
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  // 🚨 If location invalid or missing → show fallback products
  if (!lat || !lng || isNaN(latitude) || isNaN(longitude)) {
    const fallbackProducts = await Product.find({ status: 'In Stock' })
      .sort({ rating: -1 })
      .limit(10)
      .select('name images')
      .populate('vendor', 'name status');

    return res.status(200).json({
      success: true,
      message:
        'Location not provided or invalid. Showing top-rated products from all vendors.',
      data: fallbackProducts
        .filter(p => p.vendor?.status === 'Active')
        .map(p => ({
          name: p.name,
          image: p.images?.[0] || null,
          vendorName: p.vendor?.name || 'Unknown Vendor',
          distance: null,
        })),
    });
  }

  try {
    // 🧭 Find nearby active vendors
    const localVendors = await User.find({
      status: 'Active', // ✅ Only active vendors
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: parseInt(maxDistance),
        },
      },
    }).select('_id name location status');

    const vendorIds = localVendors.map(v => v._id);

    if (vendorIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active local vendors found in your area.',
      });
    }

    // 📦 Get nearby top-rated products (only in stock)
    const localBestProducts = await Product.find({
      vendor: { $in: vendorIds },
      status: 'In Stock',
    })
      .sort({ rating: -1, createdAt: -1 })
      .limit(20)
      .select('name images vendor')
      .populate('vendor', 'name location status');

    // 📏 Helper: Calculate distance (Haversine formula)
    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
      const toRad = v => (v * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // 🧮 Attach vendor distance to each product
    const productsWithDistance = localBestProducts
      .filter(p => p.vendor?.status === 'Active')
      .map(p => {
        const vendorLoc = p.vendor?.location?.coordinates;
        let distance = null;
        if (vendorLoc && vendorLoc.length === 2) {
          distance = getDistanceKm(latitude, longitude, vendorLoc[1], vendorLoc[0]);
        }
        return {
          name: p.name,
          image: p.images?.[0] || null,
          vendorName: p.vendor?.name || 'Unknown Vendor',
          distance: distance ? parseFloat(distance.toFixed(2)) : null, // km
        };
      });

    res.status(200).json({
      success: true,
      count: productsWithDistance.length,
      data: productsWithDistance,
    });
  } catch (err) {
    console.error('Error fetching local best products:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch local products. Please check the GeoJSON index.',
    });
  }
});






const getAllAroundIndiaProducts = asyncHandler(async (req, res) => {
  const buyer = await User.findById(req.user._id).select('location');

  // 📏 Helper: Haversine formula (distance in km)
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // Earth radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 🟢 Step 1: Find all active vendors
  const activeVendors = await User.find({ role: 'Vendor', status: 'Active' }).select('_id');
  const activeVendorIds = activeVendors.map(v => v._id);

  // 🟢 Step 2: Fetch all products with All India delivery & active vendor
  const products = await Product.find({
    status: 'In Stock',
    allIndiaDelivery: true,
    vendor: { $in: activeVendorIds }
  })
    .sort({ rating: -1, salesCount: -1 })
    .populate('vendor', 'name location status');

  if (products.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No All India delivery products found.'
    });
  }

  // 🧮 Step 3: Enrich with distance (if buyer and vendor have location)
  const enrichedProducts = products.map((p) => {
    let distanceText = 'N/A';
    if (p.vendor?.location?.coordinates && buyer?.location?.coordinates) {
      const [vendorLng, vendorLat] = p.vendor.location.coordinates;
      const [buyerLng, buyerLat] = buyer.location.coordinates;

      const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
      if (!isNaN(distance)) {
        distanceText = `${distance.toFixed(2)} km away`;
      }
    }

    return {
      ...p.toObject(),
      distance: distanceText
    };
  });

  // ✅ Step 4: Send Response
  res.status(200).json({
    success: true,
    message: 'All India delivery products fetched successfully.',
    count: enrichedProducts.length,
    data: enrichedProducts
  });
});




// controllers/buyerController.js

const getSmartPicks = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const userId = req.user._id;

  // ✅ Get Buyer (for location)
  const buyer = await User.findById(userId).select('location');
  if (!buyer?.location?.coordinates?.length) {
    return res.status(400).json({
      success: false,
      message: 'User location not found. Please set your delivery address.',
    });
  }

  const [buyerLon, buyerLat] = buyer.location.coordinates;

  // 📏 Helper: Haversine formula — distance between two lat/lon points (in km)
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
    return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
  };

  // ✅ Step 1: Find all Active Vendors
  const activeVendors = await User.find({ role: 'Vendor', status: 'Active' }).select('_id');
  const activeVendorIds = activeVendors.map(v => v._id);

  // ✅ Step 2: Product filter (only in-stock & from active vendors)
  const filter = {
    status: 'In Stock',
    vendor: { $in: activeVendorIds },
  };
  if (category) filter.category = category;

  // ✅ Step 3: Fetch products with vendor details
  const products = await Product.find(filter)
    .sort({ rating: -1, createdAt: -1 })
    .populate('vendor', 'name profilePicture location status');

  if (!products.length) {
    return res.status(404).json({
      success: false,
      message: category
        ? `No smart picks found for category: ${category}`
        : 'No smart picks found at this time.',
    });
  }

  // ✅ Step 4: Format each product
  const formatted = products.map((product) => {
    const image = product.images?.[0] || null;
    let distance = 'N/A';

    if (product.vendor?.location?.coordinates?.length) {
      const [vendorLon, vendorLat] = product.vendor.location.coordinates;
      distance = `${getDistanceKm(
        buyerLat,
        buyerLon,
        vendorLat,
        vendorLon
      )} km away`;
    }

    return {
      id: product._id,
      name: product.name,
      price: product.price,
      unit: product.unit || '',
      weightPerPiece: product.weightPerPiece,
      rating: product.rating || 0,
      ratingCount: product.ratingCount || 0,
      image,
      vendor: {
        id: product.vendor?._id,
        name: product.vendor?.name || 'Unknown Vendor',
        profilePicture: product.vendor?.profilePicture || null,
      },
      distanceFromVendor: distance,
    };
  });

  // ✅ Step 5: Response
  res.status(200).json({
    success: true,
    count: formatted.length,
    data: formatted,
  });
});










// @desc    Get all products grouped by category for the logged-in vendor
// @route   GET /api/vendor/products/by-category
// @access  Private/Vendor



// 🛒 Controller: Get products by category (with distance)
const getProductsByCategory = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const buyer = await User.findById(req.user._id).select('location');
  const buyerLocation = buyer?.location?.coordinates;

  if (!category) {
    return res.status(400).json({ success: false, message: "Category is required" });
  }

  // 📏 Helper: Haversine formula (distance in km)
  const getDistanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 🧩 Step 1: Find all active vendors
  const activeVendors = await User.find({ role: 'Vendor', status: 'Active' }).select('_id');
  const activeVendorIds = activeVendors.map(v => v._id);

  // 🧩 Step 2: Base query for products
  const productQuery = {
    category,
    status: 'In Stock',
    vendor: { $in: activeVendorIds },
  };

  // 🟢 Step 3: Fetch products with vendor details
  const products = await Product.find(productQuery)
    .populate('vendor', 'name location')
    .sort({ createdAt: -1, rating: -1 });

  // 🧮 Step 4: Enrich with distance
  const enriched = products.map(p => {
    let distanceText = 'N/A';

    if (p.vendor?.location?.coordinates && buyerLocation) {
      const [vendorLng, vendorLat] = p.vendor.location.coordinates;
      const [buyerLng, buyerLat] = buyerLocation;
      const distance = getDistanceKm(buyerLat, buyerLng, vendorLat, vendorLng);
      distanceText = `${parseFloat(distance.toFixed(2))} km away`;
    }

    return {
      ...p.toObject(),
      distance: distanceText, // ✅ formatted as "3.2 km away"
    };
  });

  // ✅ Step 5: Send response
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


// @desc    Get vendors near the user
// @route   GET /api/buyer/vendors/near-you
// @access  Private/Buyer
// controllers/buyerController.js

// Assuming calculateDistance is defined and available in this scope:
// const calculateDistance = (lat1, lon1, lat2, lon2) => { ... }; 
// const Product = require('../models/Product'); // Needed for formatCategories
// ...

const getVendorsNearYou = asyncHandler(async (req, res) => {
  const { lat, lng, maxDistance = 5000 } = req.query;

  // ✅ Helper: Get all categories (no slicing)
  const formatCategories = async (vendorId) => {
    const categories = await Product.distinct("category", { vendor: vendorId }) || [];
    return categories.length > 0 ? categories.join(", ") : "No categories listed";
  };

  // ❌ If location not provided
  if (!lat || !lng) {
    const vendors = await User.find({ role: "Vendor", status: "Active", isApproved: true })
      .limit(10)
      .select("name profilePicture _id address");

    const enrichedFallbackVendors = await Promise.all(
      vendors.map(async (vendor) => ({
        id: vendor._id,
        name: vendor.name,
        profilePicture: vendor.profilePicture || "https://default-image-url.com/default.png",
        distance: "N/A",
        categories: await formatCategories(vendor._id),
      }))
    );

    return res.status(200).json({
      success: true,
      count: enrichedFallbackVendors.length,
      vendors: enrichedFallbackVendors,
      message: "Location not provided by client, showing popular vendors instead.",
    });
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ success: false, message: "Invalid latitude or longitude." });
  }

  try {
    // 🧭 Find vendors near user (only active + approved)
    const vendors = await User.find({
      role: "Vendor",
      status: "Active",
      isApproved: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: parseInt(maxDistance),
        },
      },
    }).select("name profilePicture location");

    // 🧮 Calculate distance and attach categories
    const enrichedVendors = await Promise.all(
      vendors.map(async (vendor) => {
        let distance = "N/A";
        if (vendor.location?.coordinates?.length === 2) {
          const [vendorLng, vendorLat] = vendor.location.coordinates;
          distance = calculateDistance(latitude, longitude, vendorLat, vendorLng).toFixed(1);
        }

        return {
          id: vendor._id,
          name: vendor.name,
          profilePicture: vendor.profilePicture || "https://default-image-url.com/default.png",
          distance: distance !== "N/A" ? `${distance} km away` : "N/A",
          categories: await formatCategories(vendor._id),
        };
      })
    );

    res.status(200).json({
      success: true,
      count: enrichedVendors.length,
      vendors: enrichedVendors,
    });
  } catch (err) {
    console.error("Error fetching nearby vendors:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby vendors. Check GeoJSON index.",
      error: err.message,
    });
  }
});

const formatCategories = async (vendorId) => {
    // Finds unique product categories associated with this vendor
    const categories = await Product.distinct('category', { vendor: vendorId }) || [];
    const displayCategories = categories.slice(0, 2);
    const count = categories.length;

    let categoryText = displayCategories.join(', ');
    if (count > 2) {
        // Changed to comma-separated format for better reading
        categoryText += `, (+${count - 2})`;
    } else if (count === 0) {
        categoryText = 'No categories listed';
    }
    return categoryText;
};

// @desc    Get a paginated list of all active vendors for public view
// @route   GET /api/vendors?q=...&category=...&page=...
// @access  Public
const getAllVendors = asyncHandler(async (req, res) => {
    const {
        lat,
        lng,
        maxDistance = 50000,
        page = 1,
        limit = 10,
        q,
        category
    } = req.query;

    const pageSize = parseInt(limit);
    const pageNumber = parseInt(page);
    const skip = (pageNumber - 1) * pageSize;

    // --- 1. PROXIMITY SEARCH LOGIC (If lat/lng are present) ---
    if (lat && lng) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        const distanceInMeters = parseInt(maxDistance);

        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({ success: false, message: "Invalid latitude or longitude." });
        }

        try {
            // Start with base query for nearby active vendors
            let proximityQuery = {
                role: "Vendor",
                status: "Active",
                location: {
                    $near: {
                        $geometry: { type: "Point", coordinates: [longitude, latitude] },
                        $maxDistance: distanceInMeters
                    }
                }
            };

            // Apply text search (q) to the proximity query
            if (q) {
                proximityQuery.name = { $regex: q, $options: 'i' };
            }

            // Fetch vendors (Pagination is usually not applied to $near, but we can limit)
            const vendors = await User.find(proximityQuery)
                .select('name profilePicture location');

            // Format output to include distance and categories
            const enrichedVendors = await Promise.all(
                vendors.map(async vendor => {
                    let distanceText = 'N/A';

                    if (vendor.location?.coordinates?.length === 2) {
                        const [vendorLng, vendorLat] = vendor.location.coordinates;
                        const distance = calculateDistance(latitude, longitude, vendorLat, vendorLng);
                        distanceText = `${distance.toFixed(1)} km away`;
                    }

                    return {
                        id: vendor._id,
                        name: vendor.name,
                        profilePicture: vendor.profilePicture || 'https://default-image-url.com/default.png',
                        distance: distanceText,
                        categories: await formatCategories(vendor._id)
                    };
                })
            );

            // RETURN THE DESIRED FORMAT: { success: true, count: 2, vendors: [...] }
            return res.status(200).json({
                success: true,
                count: enrichedVendors.length,
                vendors: enrichedVendors
            });

        } catch (err) {
            console.error("Proximity search failed:", err);
            return res.status(500).json({ success: false, message: "Proximity search failed. Check MongoDB index." });
        }
    }

    // --- 2. PAGINATED DIRECTORY LOGIC (If lat/lng are missing) ---
    else {
        // Base query for all active vendors
        const query = { role: 'Vendor', status: 'Active' };

        if (q) query.name = { $regex: q, $options: 'i' };

        if (category) {
            const vendorsWithCategory = await Product.distinct('vendor', { category: { $regex: category, $options: 'i' } });
            query._id = { $in: vendorsWithCategory };
        }

        const totalVendors = await User.countDocuments(query);
        let vendors = await User.find(query)
            .select('name profilePicture') // Only need basic fields for this fallback list
            .limit(pageSize)
            .skip(skip)
            .sort({ name: 1 });

        const enrichedVendors = await Promise.all(
            vendors.map(async vendor => ({
                id: vendor._id,
                name: vendor.name,
                profilePicture: vendor.profilePicture || 'https://default-image-url.com/default.png',
                distance: 'N/A', // Cannot calculate distance without location
                categories: await formatCategories(vendor._id)
            }))
        );

        // RETURN THE DESIRED FORMAT, but with pagination fields added
        return res.status(200).json({
            success: true,
            count: enrichedVendors.length, // Only count on the current page
            vendors: enrichedVendors,
            page: pageNumber,
            pages: Math.ceil(totalVendors / pageSize),
            total: totalVendors,
            message: "Showing paginated directory as location was not provided."
        });
    }
});





// -----------------------------
// Cart Management
// -----------------------------

// @desc    Get buyer's cart items
// @route   GET /api/buyer/cart
// @access  Private/Buyer







// controllers/buyerController.js

// Note: calculateEstimatedDelivery, calculateOrderSummary must be defined/imported.


// 🛒 GET CART ITEMS
const getCartItems = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const deliveryDate = calculateEstimatedDelivery();
  const deliveryDateText = `Delivery by ${deliveryDate.formatted}`;

  const emptySummary = {
    totalMRP: 0,
    discount: 0,
    deliveryCharge: 0,
    totalAmount: 0,
  };

  try {
    const cart = await Cart.findOne({ user: userId })
      .populate({
        path: 'items.product',
        select: 'price vendor name images variety unit',
        populate: {
          path: 'vendor',
          select:
            'name mobileNumber email upiId address vendorDetails profilePicture status location',
        },
      })
      .lean();

    if (!cart) {
      return res.json({
        success: true,
        data: {
          items: [],
          summary: emptySummary,
          priceDetails: emptySummary,
          couponCode: '',
        },
      });
    }

    const validItems = cart.items.filter((i) => i.product);

    const summaryResult = await calculateOrderSummary(cart, cart.couponCode);
    const summary = summaryResult?.summary || emptySummary;

    const items = validItems.map((i) => {
      const vendor = i.product.vendor || {};
      return {
        id: i.product._id,
        name: i.product.name,
        subtitle: i.product.variety || '',
        mrp: i.product.price,
        imageUrl: i.product.images?.[0] || 'https://placehold.co/100x100',
        quantity: i.quantity,
        unit: i.product.unit,
        deliveryText: deliveryDateText,
        vendor: {
          id: vendor._id,
          name: vendor.name,
          mobileNumber: vendor.mobileNumber,
          email: vendor.email,
          upiId: vendor.upiId,
          contactNo: vendor.vendorDetails?.contactNo,
          about: vendor.vendorDetails?.about,
          location: vendor.vendorDetails?.location,
          deliveryRegion: vendor.vendorDetails?.deliveryRegion,
          totalOrders: vendor.vendorDetails?.totalOrders,
          profilePicture: vendor.profilePicture,
          address: vendor.address || {},
          geoLocation: vendor.location?.coordinates || [0, 0],
          status: vendor.status,
        },
      };
    });

    const priceDetails = {
      totalMRP: summary.totalMRP || 0,
      couponDiscount: summary.discount || 0,
      deliveryCharge: summary.deliveryCharge || 0,
      totalAmount: summary.totalAmount || 0,
    };

    const formattedSummary = {
      TotalMRP: `₹ ${priceDetails.totalMRP.toFixed(2)}`,
      CouponDiscount: `₹ ${priceDetails.couponDiscount.toFixed(2)}`,
      DeliveryCharge: `₹ ${priceDetails.deliveryCharge.toFixed(2)}`,
      TotalAmount: `₹ ${priceDetails.totalAmount.toFixed(2)}`,
    };

    res.json({
      success: true,
      data: {
        items,
        summary: formattedSummary,
        priceDetails,
        couponCode: cart.couponCode || '',
      },
    });
  } catch (error) {
    console.error('❌ getCartItems error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to load cart details.' });
  }
});









// 🎟 APPLY COUPON
const applyCouponToCart = asyncHandler(async (req, res) => {
    const { code } = req.body;
    const userId = req.user._id;

    if (!code) {
        return res.status(400).json({ success: false, message: 'Coupon code is required.' });
    }

    // Fetch user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || !cart.items.length) {
        return res.status(404).json({ success: false, message: 'Your cart is empty.' });
    }

    // Validate coupon
    const coupon = await Coupon.findOne({
        code: code.toUpperCase(),
        status: 'Active',
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
    });

    if (!coupon) {
        return res.status(400).json({ success: false, message: 'Invalid, expired, or inactive coupon code.' });
    }

    // Check per-user usage limit using coupon.usedBy
    const userUsage = coupon.usedBy.find(u => u.user.toString() === userId.toString());
    if (coupon.usageLimitPerUser && userUsage?.count >= coupon.usageLimitPerUser) {
        return res.status(400).json({
            success: false,
            message: `You have already used this coupon the maximum allowed times (${coupon.usageLimitPerUser}).`
        });
    }

    // Check total usage limit
    if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit) {
        return res.status(400).json({
            success: false,
            message: 'This coupon has reached its total usage limit.'
        });
    }

    // Calculate total MRP of cart
    let totalMRP = 0;
    cart.items.forEach(item => {
        const price = item.product?.price || 0;
        const qty = item.quantity || 1;
        totalMRP += price * qty;
    });

    // Check minimum order
    if (coupon.minimumOrder && totalMRP < coupon.minimumOrder) {
        return res.status(400).json({
            success: false,
            message: `Minimum order amount for this coupon is ₹${coupon.minimumOrder}.`
        });
    }

    // Apply discount
    let discount = 0;
    if (coupon.discount.type === 'Percentage') {
        discount = (totalMRP * coupon.discount.value) / 100;
    } else if (coupon.discount.type === 'Fixed') {
        discount = coupon.discount.value;
    }
    if (discount > totalMRP) discount = totalMRP;

    // Delivery charge
    const deliveryCharge = totalMRP > 500 ? 0 : 50;
    const totalAmount = totalMRP - discount + deliveryCharge;

    // Save coupon code to cart
    cart.couponCode = code;
    await cart.save();

    // Respond
    res.status(200).json({
        success: true,
        message: 'Coupon applied successfully.',
        summary: {
            TotalMRP: `₹ ${totalMRP.toFixed(2)}`,
            CouponDiscount: `₹ ${discount.toFixed(2)}`,
            DeliveryCharge: `₹ ${deliveryCharge.toFixed(2)}`,
            TotalAmount: `₹ ${totalAmount.toFixed(2)}`
        },
        priceDetails: {
            totalMRP,
            couponDiscount: discount,
            deliveryCharge,
            totalAmount
        },
        couponCode: code
    });
});



















// @desc    Add item to cart
// @route   POST /api/buyer/cart/add
// @access  Private/Buyer
// @desc    Add item to cart
// @route   POST /api/buyer/cart/add
// @access  Private/Buyer
// controllers/buyerController.js (only addItemToCart part)
// controllers/buyerController.js (Corrected addItemToCart logic)
// controllers/buyerController.js

// Note: calculateOrderSummary and Cart, Product, User models must be imported.

const addItemToCart = asyncHandler(async (req, res) => {
    const { productId, quantity = 1 } = req.body;
    const userId = req.user._id;


    if (!productId || quantity <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Product ID and valid quantity are required.'
        });
    }

    // --- 1️⃣ Fetch product details ---
    const product = await Product.findById(productId)
        .select('name price weightPerPiece vendor status images unit variety');

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (product.status !== 'In Stock' || product.price == null) {
        return res.status(400).json({ success: false, message: 'Product is out of stock or invalid.' });
    }

    // --- 2️⃣ Find or create user's cart ---
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
        cart = await Cart.create({ user: userId, items: [] });
    }


    // --- 3️⃣ Vendor consistency check ---
    const existingVendors = cart.items.map(i => i.vendor?.toString()).filter(Boolean);

    if (existingVendors.length > 0 && existingVendors[0] !== product.vendor.toString()) {
        return res.status(400).json({
            success: false,
            message: 'You can only add products from one vendor. Please choose products from the same vendor.'
        });
    }

    // --- 4️⃣ Add or update product ---
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

    // --- 5️⃣ Recalculate summary ---
    const summary = await calculateOrderSummary(cart, cart.couponCode);

    // --- 6️⃣ Populate for response ---
    const populatedCart = await Cart.findById(cart._id)
        .populate('items.product', 'name price variety images unit vendor')
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




/**
 * @desc    Place order (supports multiple vendors, delivery/pickup)
 * @route   POST /api/buyer/orders/place
 * @access  Private/Buyer
 */

const placeOrder = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {
        deliveryType,
        addressId,
        pickupSlot,
        couponCode,
        comments,
        paymentMethod
    } = req.body;

    // --- 1️⃣ Fetch Cart ---
    const cart = await Cart.findOne({ user: userId })
        .populate({
            path: 'items.product',
            select: 'name price vendor images unit'
        })
        .lean();

    if (!cart || !cart.items.length) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    const validItems = cart.items.filter(i => i.product && typeof i.product.price === 'number');
    if (!validItems.length) {
        return res.status(400).json({ success: false, message: 'Cart contains invalid products.' });
    }

    // --- 2️⃣ Validate delivery/payment options ---
    if (!['Delivery', 'Pickup'].includes(deliveryType)) {
        return res.status(400).json({ success: false, message: 'Valid deliveryType is required (Delivery or Pickup).' });
    }

    if (!['Cash', 'UPI'].includes(paymentMethod)) {
        return res.status(400).json({ success: false, message: 'Valid paymentMethod (Cash or UPI) is required.' });
    }

    if (deliveryType === 'Delivery' && paymentMethod === 'Cash') {
        return res.status(400).json({ success: false, message: 'Cash payment is only allowed for Pickup orders.' });
    }

    // --- 🕒 Validate pickup slot ---
    if (deliveryType === 'Pickup') {
        if (!pickupSlot || !pickupSlot.date || !pickupSlot.startTime || !pickupSlot.endTime) {
            return res.status(400).json({
                success: false,
                message: 'Pickup slot must include date, startTime, and endTime.'
            });
        }
    }

    // --- 3️⃣ Validate Address ---
    let shippingAddress = null;
    if (deliveryType === 'Delivery') {
        shippingAddress = await Address.findById(addressId);
        if (!shippingAddress) {
            return res.status(404).json({ success: false, message: 'Shipping address not found.' });
        }
    }

    // --- 4️⃣ Validate Coupon (if provided) ---
    let coupon = null;
    if (couponCode) {
        coupon = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            status: 'Active',
            startDate: { $lte: new Date() },
            expiryDate: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(400).json({ success: false, message: 'Invalid or expired coupon.' });
        }

        const userUsage = coupon.usedBy.find(u => u.user.toString() === userId.toString());
        const userUsedCount = userUsage ? userUsage.count : 0;

        if (coupon.usageLimitPerUser && userUsedCount >= coupon.usageLimitPerUser) {
            return res.status(400).json({
                success: false,
                message: `You have already used this coupon the maximum allowed times (${coupon.usageLimitPerUser}).`
            });
        }

        if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit) {
            return res.status(400).json({
                success: false,
                message: `This coupon has reached its total usage limit.`
            });
        }
    }

    // --- 5️⃣ Group items by vendor ---
    const ordersByVendor = validItems.reduce((acc, item) => {
        const vendorId = item.product.vendor?.toString();
        if (vendorId) {
            if (!acc[vendorId]) acc[vendorId] = { items: [], vendor: vendorId };
            acc[vendorId].items.push(item);
        }
        return acc;
    }, {});

    const createdOrderIds = [];
    const payments = [];
    let grandTotalAmount = 0;
    let totalDiscount = 0;

    const isOnlinePayment = paymentMethod === 'UPI';
    const orderStatus = isOnlinePayment ? 'In-process' : 'Confirmed';
    const isPaid = !isOnlinePayment;

    // --- 6️⃣ Process each vendor ---
    for (const vendorId in ordersByVendor) {
        const vendorData = ordersByVendor[vendorId];
        const vendorItems = vendorData.items;

        const summaryResult = await calculateOrderSummary(
            { items: vendorItems, user: userId },
            couponCode,
            deliveryType
        );

        const summary = summaryResult.summary;

        if (!summary.totalAmount || isNaN(summary.totalAmount)) {
            return res.status(400).json({ success: false, message: 'Invalid total amount in order summary.' });
        }

        grandTotalAmount += summary.totalAmount;
        totalDiscount += summary.discount || 0;

        const vendor = await User.findById(vendorId).select('name upiId').lean();

        // ✅ Create Order with proper pickup slot format
        const newOrder = new Order({
            orderId: `ORDER#${Math.floor(10000 + Math.random() * 90000)}`,
            buyer: userId,
            vendor: vendorId,
            products: vendorItems.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.product.price,
                vendor: vendorId
            })),
            totalPrice: parseFloat(summary.totalAmount.toFixed(2)),
            discount: summary.discount || 0,
            couponCode: couponCode || null,
            orderType: deliveryType,
            orderStatus,
            shippingAddress: shippingAddress || null,
            pickupSlot: deliveryType === 'Pickup' ? {
                date: pickupSlot.date,
                startTime: pickupSlot.startTime,
                endTime: pickupSlot.endTime
            } : null,
            comments: comments || '',
            paymentMethod,
            isPaid
        });

        const createdOrder = await newOrder.save();
        createdOrderIds.push(createdOrder._id);

        // --- 💰 Generate UPI Payment (if applicable) ---
        if (isOnlinePayment && vendor?.upiId) {
            const transactionRef = `TXN-${createdOrder.orderId.replace('#', '-')}-${Date.now()}`;
            const upiUrl = `upi://pay?pa=${encodeURIComponent(vendor.upiId)}&pn=${encodeURIComponent(vendor.name)}&am=${summary.totalAmount.toFixed(2)}&tn=${encodeURIComponent(`Payment for Order ${createdOrder.orderId}`)}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
            const qrCodeDataUrl = await QRCode.toDataURL(upiUrl);

            // 🕒 Expiry after 2 minutes
            const qrExpiry = new Date(Date.now() + 2 * 60 * 1000);

            createdOrder.qrExpiry = qrExpiry;
            await createdOrder.save();

            payments.push({
                orderId: createdOrder._id,
                vendorName: vendor.name,
                upiId: vendor.upiId,
                amount: Math.round(summary.totalAmount.toFixed(2)),
                discount: summary.discount || 0,
                upiUrl,
                qrCode: qrCodeDataUrl,
                transactionRef,
                qrExpiry,
            });

            // 🧹 Automatically close QR after 2 minutes
            setTimeout(async () => {
                const order = await Order.findById(createdOrder._id);
                if (order && !order.isPaid) {
                    order.qrClosed = true; // Frontend can use this to hide QR
                    await order.save();
                }
            }, 2 * 60 * 1000);
        }
    }

    // --- 7️⃣ Update coupon usage counts ---
    if (couponCode && coupon) {
        coupon.usedCount = (coupon.usedCount || 0) + 1;

        const existingUser = coupon.usedBy.find(u => u.user.toString() === userId.toString());
        if (existingUser) {
            existingUser.count += 1;
        } else {
            coupon.usedBy.push({ user: userId, count: 1 });
        }

        if (coupon.totalUsageLimit && coupon.usedCount >= coupon.totalUsageLimit) {
            coupon.status = 'Expired';
        }

        await coupon.save();
    }

    // --- 8️⃣ Clear cart ---
    // --- 8️⃣ Clear cart immediately after order placement ---
await Cart.findOneAndUpdate(
  { user: userId },
  { $set: { items: [] } } // empty the items array
);


    // ✅ 9️⃣ Notify Admin
    await createAndSendNotification(
        req,
        'New Order Placed',
        `A new order has been placed by user ${req.user.name || req.user._id}.`,
        {
            userId,
            orderIds: createdOrderIds,
            totalAmount: grandTotalAmount.toFixed(2),
            paymentMethod,
            deliveryType,
        }
    );

    // --- 🔟 Response ---
    res.status(201).json({
        success: true,
        message: isOnlinePayment
            ? 'Orders placed successfully. Proceed to payment.'
            : 'Order confirmed. Cash payment selected.',
        orderIds: createdOrderIds,
        totalAmountToPay: grandTotalAmount.toFixed(2),
        totalDiscount: totalDiscount.toFixed(2),
        paymentMethod,
        payments,
        pickupSlot: deliveryType === 'Pickup' ? pickupSlot : null
    });
});
























/**
 * @desc    Verify UPI payment for an order
 * @route   POST /api/buyer/orders/verify-payment
 * @access  Private
 */
const verifyPayment = asyncHandler(async (req, res) => {
    const { orderId, transactionId } = req.body;

    if (!orderId || !transactionId) {
        return res.status(400).json({ success: false, message: 'orderId and transactionId are required.' });
    }

    // Find the order by _id or orderId
    const order = await Order.findById(orderId); // you can also use orderId if you prefer
    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Only allow verification if order is still pending
    if (order.orderStatus !== 'Pending Payment') {
        return res.status(400).json({ success: false, message: `Order cannot be verified. Current status: ${order.orderStatus}` });
    }

    // Update order status to Paid
    order.orderStatus = 'Paid';
    order.transactionId = transactionId;
    await order.save();

    res.status(200).json({
        success: true,
        message: 'Payment verified successfully.',
        order: order
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
                        .select('name images unit quantity weightPerPiece price vendor')
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




/**
 * @desc    Get detailed information for a single order, including vendor and shipping details.
 * @route   GET /api/buyer/orders/:orderId
 * @access  Private/Buyer
 */
const getOrderDetails = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    // 1️⃣ Find order for the logged-in buyer
    const order = await Order.findOne({ _id: orderId, buyer: req.user._id }).lean();
    if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 2️⃣ Populate product & vendor for each item
    const populatedItems = await Promise.all(
        (order.products || []).map(async (item) => {
            if (!item.product) return null;

            const product = await Product.findById(item.product)
                .select('name images variety price unit vendor quantity weightPerPiece description category')
                .lean();
            if (!product) return null;

            const vendor = await User.findById(product.vendor)
                .select('name profilePicture mobileNumber address vendorDetails.about')
                .lean();

            // ✅ Fetch all reviews for this product
            const reviews = await Review.find({ product: product._id })
                .populate('user', 'name profilePicture')
                .sort({ createdAt: -1 })
                .select('rating comment images createdAt')
                .lean();

            return {
                ...item,
                product,
                vendor,
                reviews
            };
        })
    );

    // 3️⃣ Format items and vendor details
    const finalItems = [];
    let primaryVendorDetails = {};
    let buyerShippingAddress = {};

    for (const item of populatedItems.filter(Boolean)) {
        finalItems.push({
            id: item.product._id,
            name: item.product.name,
            description: item.product.description || '',
            category: item.product.category || '',
            subtext: item.product.variety || item.product.category,
            quantity: item.quantity,
            image: item.product.images?.[0] || null,
            price: item.product.price,
            unit: item.product.unit,
            weightPerPiece: item.product.weightPerPiece,
            reviews: item.reviews.map(r => ({
                id: r._id,
                rating: r.rating,
                comment: r.comment,
                images: r.images || [],
                createdAt: r.createdAt,
                user: r.user || null
            }))
        });

        // 🧍 Primary Vendor Info
        if (item.vendor) {
            const address =
                item.vendor.address ||
                item.vendor.vendorDetails?.address ||
                item.vendor.vendorDetails?.businessAddress ||
                null;

            primaryVendorDetails = {
                name: item.vendor.name,
                mobileNumber: item.vendor.mobileNumber,
                address: address,
                profilePicture: item.vendor.profilePicture,
                about: item.vendor.vendorDetails?.about || ''
            };
        }
    }

    // 4️⃣ Buyer shipping address
    if (order.shippingAddress) {
        buyerShippingAddress = order.shippingAddress;
    }

    // 5️⃣ Final formatted response
    const finalOrder = {
        ...order,
        vendorDetails: primaryVendorDetails,
        items: finalItems,
        shippingAddress: buyerShippingAddress,
        deliveryDate: formatDeliveryDate(order.createdAt)
    };

    res.status(200).json({
        success: true,
        order: finalOrder
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
    const { page = 1, limit = 10 } = req.query; // default: page 1, 10 items per page
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





/**
 * @desc    Remove an item from the buyer's wishlist.
 * @route   DELETE /api/buyer/wishlist/:id
 * @access  Private/Buyer
 */


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
        weightPerPiece:item.weightPerPiece,
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
    
    res.json({ success: true, message: 'Logged out successfully' });
});

// -----------------------------
// Addresses
// -----------------------------

const getAddresses = asyncHandler(async (req, res) => {
    // Fetch all addresses for the logged-in user (exclude name and mobileNumber)
    const addresses = await Address.find({ user: req.user._id })
        .select('-name -mobileNumber') // exclude these fields
        .lean();

    if (!addresses || addresses.length === 0) {
        return res.status(404).json({ success: false, message: 'No addresses found.' });
    }

    // Format the response
    const formattedAddresses = addresses.map(addr => ({
        id: addr._id.toString(),
        isDefault: addr.isDefault,
        pinCode: addr.pinCode,
        houseNumber: addr.houseNumber,
        locality: addr.locality,
        city: addr.city,
        district: addr.district,
        state: addr.state,
        location: addr.location || { type: 'Point', coordinates: [] },
        createdAt: addr.createdAt,
        updatedAt: addr.updatedAt
    }));

    res.status(200).json({
        success: true,
        message: 'All addresses retrieved successfully.',
        addresses: formattedAddresses
    });
});



const addAddress = asyncHandler(async (req, res) => {
    const { 
        pinCode, 
        houseNumber, 
        locality, 
        city, 
        district, 
        state, 
        isDefault, 
        latitude, 
        longitude 
    } = req.body;

    // --- 1. Basic Validation ---
    if (!pinCode || !houseNumber || !locality || !city || !district) {
        return res.status(400).json({ 
            success: false, 
            message: 'All required address fields must be filled.' 
        });
    }
    
    // --- 2. GeoJSON Location ---
    let geoJsonLocation = undefined; 
    if (latitude && longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
            geoJsonLocation = {
                type: 'Point',
                coordinates: [lng, lat] // GeoJSON is always [lng, lat]
            };
        }
    }
    
    // --- 3. Default Address Logic ---
    if (isDefault) {
        await Address.updateMany({ user: req.user._id, isDefault: true }, { isDefault: false });
    }

    // --- 4. Create New Address ---
    const newAddress = await Address.create({
        user: req.user._id,
        pinCode,
        houseNumber,
        locality,
        city,
        district,
        state,
        isDefault: isDefault || false,
        location: geoJsonLocation 
    });

    res.status(201).json({
        success: true,
        message: 'Address added successfully.',
        address: newAddress
    });
});




const updateAddress = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { pinCode, houseNumber, locality, city, district, state, isDefault, latitude, longitude } = req.body;

    if (!pinCode) {
        return res.status(400).json({ success: false, message: "Pin Code is required." });
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid address ID." });
    }

    const address = await Address.findOne({ _id: id, user: req.user._id });
    if (!address) {
        return res.status(404).json({ success: false, message: "Address not found." });
    }

    // Unset other defaults if needed
    if (isDefault) {
        await Address.updateMany({ user: req.user._id, isDefault: true }, { isDefault: false });
    }

    // Update main fields
    address.pinCode = pinCode;
    address.houseNumber = houseNumber;
    address.locality = locality;
    address.city = city;
    address.district = district;
    address.state = state;
    address.isDefault = isDefault || address.isDefault;

    // Optional GeoJSON location
    if (latitude && longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            address.location = {
                type: 'Point',
                coordinates: [lng, lat] // GeoJSON format
            };
        }
    }

    await address.save();

    res.status(200).json({
        success: true,
        message: "Address updated successfully.",
        address
    });
});

const deleteAddress = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid address ID."
        });
    }

    // Find address belonging to the logged-in user
    const address = await Address.findOne({ _id: id, user: req.user._id });
    if (!address) {
        return res.status(404).json({
            success: false,
            message: "Address not found."
        });
    }

    // Delete the address
    await Address.deleteOne({ _id: id });

    res.status(200).json({
        success: true,
        message: "Address deleted successfully."
    });
});




const setDefaultAddress = asyncHandler(async (req, res) => {
    await Address.updateMany({ user: req.user._id }, { isDefault: false });
    const address = await Address.findByIdAndUpdate(req.params.id, { isDefault: true }, { new: true });
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    res.json({ success: true, message: 'Default address set', data: address });
});





// ---------------- GET PICKUP LOCATION DETAILS ----------------


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

        const formattedDate = `${String(tomorrow.getDate()).padStart(2, "0")}/${
            String(tomorrow.getMonth() + 1).padStart(2, "0")
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
            weightPerPiece:product.weightPerPiece,
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



/**
 * @desc    Find all vendors selling products matching the search query
 * @route   GET /api/buyer/vendors/by-product?q=productName&lat=28.7&lng=77.1&page=1&limit=10
 * @access  Private/Buyer
 */
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
        weightPerPiece:p.weightPerPiece,
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
  const { amount, message = '', paymentMethod = 'UPI' } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid donation amount.'
    });
  }

  // --- 1. Find admin ---
  const admin = await User.findOne({ role: 'Admin' }).select('name upiId');
  if (!admin) {
    return res.status(404).json({ success: false, message: 'Admin not found.' });
  }

  if (!admin.upiId && paymentMethod === 'UPI') {
    return res.status(400).json({
      success: false,
      message: 'Admin has not configured UPI ID for donations.'
    });
  }

  // --- 2. Prepare transaction details ---
  const transactionRef = `DONATE-${Date.now()}`;
  const isOnline = paymentMethod === 'UPI';

  let upiUrl = null;
  let qrCode = null;

  if (isOnline) {
    upiUrl = `upi://pay?pa=${encodeURIComponent(admin.upiId)}&pn=${encodeURIComponent(admin.name)}&am=${amount.toFixed(
      2
    )}&tn=${encodeURIComponent('Donation to Admin')}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;

    qrCode = await QRCode.toDataURL(upiUrl);
  }

  // --- 3. Save donation record ---
  const donation = await Donation.create({
    donor: userId,
    admin: admin._id,
    amount,
    message,
    paymentMethod,
    transactionRef,
    upiUrl,
    qrCode,
    status: isOnline ? 'Pending' : 'Completed',
  });

  // --- 4. Send admin notification ---
  await createAndSendNotification(
    req,
    'New Donation Received',
    `You have received a donation of ₹${amount.toFixed(2)} from a user.`,
    {
      donationId: donation._id,
      donorId: userId,
      amount,
      paymentMethod,
      transactionRef
    }
  );

  // --- 5. Respond ---
  res.status(201).json({
    success: true,
    message: isOnline
      ? 'Donation created successfully. Please complete the UPI payment.'
      : 'Cash donation recorded successfully.',
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

  let query = {};

  // If "name" is provided, filter by it (case-insensitive)
  if (name && name.trim() !== '') {
    query.name = { $regex: name.trim(), $options: 'i' };
  }

  // Fetch products from DB
  const products = await Product.find(query).populate('vendor', 'name');

  // Handle no products
  if (!products || products.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'No products found.',
      products: [],
    });
  }

  // Return all products or filtered results
  res.status(200).json({
    success: true,
    count: products.length,
    products,
  });
});


const markOrderPaid = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { orderId } = req.params;

  const order = await Order.findOne({ _id: orderId, buyer: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found." });
  }

  if (order.isPaid) {
    return res.status(400).json({ success: false, message: "Order already marked as paid." });
  }

  order.isPaid = true;
  order.orderStatus = "Confirmed";
  await order.save();

  res.json({
    success: true,
    message: "Payment confirmed and QR closed.",
  });
});



module.exports = {
    getHomePageData,getProductsByVendorId,donateToAdmin,getDonationsReceived,searchProductsByName,
    getProductDetails, markOrderPaid,
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
    removeFromWishlist, searchAllProducts,
    reorder,
    getBuyerProfile,
    updateBuyerProfile,
    logout,
    getOrderDetails,
    setDefaultAddress,deleteAddress,getProductById,
    updateBuyerLocation, addToWishlist, getAllVendors, getVendorsByProductName, getProductsByName,updateAddress,
    updateBuyerLanguage, getHighlightedCoupon, getPickupLocationDetails, getPickupLocationDetailsPost, selectPickupSlot,
    writeReview, getProductsByCategory, getVendorProfileForBuyer, getProductReviews, getAvailableCouponsForBuyer,
    getBuyerOrders, getLocalBestProducts, getAllAroundIndiaProducts, getSmartPicks, getCouponsByProductId,
    getOrderDetails, searchProducts, getFreshAndPopularProducts, generateUpiPaymentUrl,
    getReviewsForProduct, updateReview, deleteReview, applyCouponToCart, startCheckout, verifyPayment, addAddress, getAddresses, getStaticPageContent
};
