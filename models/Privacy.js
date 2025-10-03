const mongoose = require('mongoose');

const staticPageSchema = new mongoose.Schema({
    pageName: { type: String, required: true, unique: true },
    content: { type: String, default: '' },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('StaticPage', staticPageSchema);
