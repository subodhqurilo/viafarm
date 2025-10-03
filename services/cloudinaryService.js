const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'farm-ecomm-products',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

const upload = multer({ storage }); // For routes

// Helper functions for controller usage
const cloudinaryUpload = (filePath, folder = 'farm-ecomm-products') => {
  return cloudinary.uploader.upload(filePath, { folder });
};

const cloudinaryDestroy = (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = { cloudinary, upload, cloudinaryUpload, cloudinaryDestroy };
