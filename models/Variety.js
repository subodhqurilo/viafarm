const mongoose = require('mongoose');

const varietySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true,
  },
}, { timestamps: true });

// Unique inside same category
varietySchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Variety", varietySchema);
