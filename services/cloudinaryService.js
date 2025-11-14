const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

require("dotenv").config();



// 🔹 Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🔹 Multer Storage With Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "farm-ecomm-products",
    allowed_formats: ["jpg", "jpeg", "png"],
    resource_type: "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});

// 🔹 Multer Upload Middleware
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only .jpg, .jpeg, and .png formats are allowed!"));
    }
    cb(null, true);
  },
});

// 🔹 Cloudinary Delete Helper
const cloudinaryDestroy = async (publicId) => {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete error:", error);
  }
};

// ⚡ Export
module.exports = {
  cloudinary,
  upload,
  cloudinaryDestroy,
};
