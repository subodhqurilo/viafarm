const mongoose = require('mongoose');
const PushTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  token: { type: String, required: true, unique: true },
  platform: { type: String },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PushToken', PushTokenSchema);







