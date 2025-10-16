const mongoose = require('mongoose');
const Product = require('./Product');

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderItem: { type: String, required: true, unique: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: String,
  images: [String],
}, { timestamps: true });

// After a review is added
reviewSchema.post('save', async function () {
  try {
    await updateProductRating(this.product);
  } catch (err) {
    console.error("Error updating product rating after save:", err);
  }
});

// After a review is removed
reviewSchema.post('remove', async function () {
  try {
    await updateProductRating(this.product);
  } catch (err) {
    console.error("Error updating product rating after remove:", err);
  }
});

// Function to calculate average rating
async function updateProductRating(productId) {
  if (!productId) return;

  // Ensure ObjectId is correctly created
  const prodId = mongoose.Types.ObjectId(productId);

  const result = await mongoose.model('Review').aggregate([
    { $match: { product: prodId } },
    { $group: { _id: '$product', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  if (result.length > 0) {
    await Product.findByIdAndUpdate(prodId, {
      rating: parseFloat(result[0].avgRating.toFixed(1)),
      ratingCount: result[0].count
    }, { new: true });
  } else {
    await Product.findByIdAndUpdate(prodId, { rating: 0, ratingCount: 0 }, { new: true });
  }
}

module.exports = mongoose.model('Review', reviewSchema);
