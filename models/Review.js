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

// ⭐ After a review is saved — add to Product.reviews
reviewSchema.post('save', async function () {
  try {
    // Add review ID to product
    await Product.findByIdAndUpdate(
      this.product,
      { $addToSet: { reviews: this._id } }
    );

    await updateProductRating(this.product);
  } catch (err) {
    console.error("Error updating product after review save:", err);
  }
});

// ⭐ After a review is removed — pull from Product.reviews
reviewSchema.post('remove', async function () {
  try {
    await Product.findByIdAndUpdate(
      this.product,
      { $pull: { reviews: this._id } }
    );

    await updateProductRating(this.product);
  } catch (err) {
    console.error("Error updating product after review remove:", err);
  }
});

// ⭐ Recalculate product rating
async function updateProductRating(productId) {
  if (!productId) return;

  const prodId = mongoose.Types.ObjectId(productId);

  const result = await mongoose.model('Review').aggregate([
    { $match: { product: prodId } },
    { $group: { _id: '$product', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  if (result.length > 0) {
    await Product.findByIdAndUpdate(prodId, {
      rating: parseFloat(result[0].avgRating.toFixed(1)),
      ratingCount: result[0].count
    });
  } else {
    await Product.findByIdAndUpdate(prodId, { rating: 0, ratingCount: 0 });
  }
}

module.exports = mongoose.model('Review', reviewSchema);
