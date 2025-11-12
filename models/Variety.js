const varietySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true
  },
});

module.exports = mongoose.model("Variety", varietySchema);
