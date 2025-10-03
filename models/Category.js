const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  image: {
    url: {
      type: String,
      required: false,
    },
    public_id: {
      type: String,
      required: false,
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
