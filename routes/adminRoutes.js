const express = require("express");
const asyncHandler = require("express-async-handler");

const router = express.Router();
const adminController = require("../controllers/adminController");
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const { upload } = require("../services/cloudinaryService");

// -------------------------
// ✅ PUBLIC ROUTES
// -------------------------

router.get("/manage-app/coupons", adminController.getAdminCoupons);
router.get("/manage-app/categories", adminController.getCategories);
router.get("/manage-app/categories/:id", adminController.getCategoryById);
router.get("/manage-app/customer-support", adminController.getCustomerSupportDetails);

// Public Static Pages (only GET)
router.get(
  "/manage-app/page/:pageName",
  asyncHandler(adminController.getStaticPageContent)
);

// Public Banners
router.get("/public/manage-app/banners", adminController.getBanners);
router.get(
  "/public/manage-app/banners/placement/:placement",
  adminController.getBannersByPlacement
);

// -------------------------
// 🔐 PROTECTED ROUTES (AUTH REQUIRED)
// -------------------------
router.use(authMiddleware);

// Vendors & Buyers
router.get("/vendors", adminController.getVendors);
router.get("/vendor/:id", adminController.getVendorDetails);
router.get("/buyers", adminController.getBuyers);
router.get("/buyer/:id", adminController.getBuyerDetails);

// User Notification Settings
router.get("/settings/user-notifications", adminController.getuserNotificationSettings);
router.put("/settings/user-notifications", adminController.updateuserNotificationSettings);

// -------------------------
// 👑 ADMIN ONLY ROUTES
// -------------------------
router.use(authorizeRoles("Admin"));

// Customer Support
router.put("/manage-app/customer-support", adminController.updateCustomerSupportDetails);

// Static Pages (Admin Update)
router.put(
  "/manage-app/page/:pageName",
  asyncHandler(adminController.updateStaticPageContent)
);

router.post("/manage-app/pages", adminController.postPageContent);

// Dashboard
router.get("/dashboard", adminController.getDashboardStats);
router.get("/recent-activity", adminController.getRecentActivity);

// -------------------------
// 🛒 PRODUCT MANAGEMENT
// -------------------------

router.get("/products", adminController.getProducts);
router.get("/products/:id", adminController.getAdminProductDetails);
router.put(
  "/products/:id/nutritional-value",
  adminController.addOrUpdateNutritionalValue
);
router.delete("/products/:id", adminController.deleteProduct);

// -------------------------
// 🧑‍🌾 VENDOR MANAGEMENT
// -------------------------

router.put("/vendors/:id/approve", adminController.approveVendor);
router.put("/vendors/:id/reject", adminController.rejectVendor);
router.put("/vendors/:id/status", adminController.updateVendorStatus);
router.delete("/vendors/:id", adminController.deleteVendor);

// -------------------------
// 👤 BUYER MANAGEMENT
// -------------------------

router.put("/buyers/:id/block", adminController.blockBuyer);
router.delete("/users/:id", adminController.deleteBuyer);

// -------------------------
// 📦 ORDER MANAGEMENT
// -------------------------

router.get("/orders", adminController.getOrders);
router.get("/orders/:id", adminController.getOrderDetail);
router.delete("/orders/:id", adminController.deleteOrder);

// -------------------------
// 🖼 BANNER MANAGEMENT
// -------------------------

// Allow multiple images (controller supports many)
router.post(
  "/manage-app/banners",
  upload.array("images", 10),
  adminController.createBanner
);

router.delete("/manage-app/banners/:id", adminController.deleteBanner);

// -------------------------
// 🗂 CATEGORY MANAGEMENT
// -------------------------

router.post(
  "/manage-app/categories",
  upload.single("image"),
  adminController.createCategory
);

router.put(
  "/manage-app/categories/:id",
  upload.single("image"),
  adminController.updateCategory
);

router.delete("/manage-app/categories/:id", adminController.deleteCategory);

// -------------------------
// 🎟 COUPONS
// -------------------------

router.post("/manage-app/coupons", adminController.createCoupon);
router.put("/manage-app/coupons/:id", adminController.updateCoupon);
router.delete("/manage-app/coupons/:id", adminController.deleteCoupon);

// -------------------------
// ⚙ SETTINGS
// -------------------------

router.get("/settings/profile", adminController.getAdminProfile);

router.put(
  "/settings/profile",
  upload.single("profilePicture"),
  adminController.updateAdminProfile
);

router.delete("/settings/profile-picture", adminController.deleteAdminProfilePicture);

router.post("/settings/change-password", adminController.changeAdminPassword);
router.get("/settings/notifications", adminController.getNotificationSettings);
router.put("/settings/notifications", adminController.updateNotificationSettings);

module.exports = router;
