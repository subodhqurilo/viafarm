// models/Banner.js

const mongoose = require('mongoose');

const BannerSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: false,
  },
  link: {
    type: String,
    required: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('Banner', BannerSchema);