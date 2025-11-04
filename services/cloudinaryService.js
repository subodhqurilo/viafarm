const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config();

// 🔹 Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🔹 Storage Setup
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'farm-ecomm-products',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

// ✅ 5 MB Limit + Validation
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB in bytes
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only .jpg, .jpeg, and .png formats are allowed!'));
    }
    cb(null, true);
  },
});

// 🔹 Helper functions for controller usage
const cloudinaryUpload = (filePath, folder = 'farm-ecomm-products') => {
  return cloudinary.uploader.upload(filePath, { folder });
};

const cloudinaryDestroy = (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = { cloudinary, upload, cloudinaryUpload, cloudinaryDestroy };
