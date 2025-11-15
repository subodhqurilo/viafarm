const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🔥 Universal Upload Function — Supports Folder
const cloudinaryUpload = async (filePath, folder = "default-folder") => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });
    return result;
  } catch (error) {
    console.log("❌ Cloudinary Upload Error ----------");
    console.log(error);
    throw new Error("Cloudinary upload failed");
  }
};

// 🔥 Destroy image by public id
const cloudinaryDestroy = async (publicId) => {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.log("❌ Cloudinary Destroy Error ----------");
    console.log(error);
  }
};

// 🔥 Multer Storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder: "app-uploads",
    allowed_formats: ["jpg", "jpeg", "png"],
  }),
});

const upload = multer({ storage });

module.exports = {
  cloudinaryUpload,
  cloudinaryDestroy,
  upload,
};
