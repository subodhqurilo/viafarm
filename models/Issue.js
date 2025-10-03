const mongoose = require('mongoose');

const IssueSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    issueDescription: {
        type: String,
        required: true,
    },
    photos: {
        type: [String], // URLs from Cloudinary
        default: [],
    },
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    status: {
        type: String,
        enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
        default: 'Open',
    },
}, { timestamps: true });

module.exports = mongoose.model('Issue', IssueSchema);
