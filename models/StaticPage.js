const mongoose = require('mongoose');

const StaticPageSchema = new mongoose.Schema({
    pageName: {
        type: String,
        required: [true, 'Page name is required'],
        unique: true,
        trim: true,
        lowercase: true
    },
    content: {
        type: String,
        required: [true, 'Page content is required'],
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('StaticPage', StaticPageSchema);
