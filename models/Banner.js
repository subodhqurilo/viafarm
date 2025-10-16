const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    // --- CONTENT & MEDIA ---

    /**
     * बैनर की इमेज का URL
     * Example: Cloudinary or S3 URL
     */
    imageUrl: {
        type: String,
        required: true,
    },

    /**
     * Cloudinary में इमेज का Public ID
     */
    public_id: {
        type: String,
        required: true,
    },

    /**
     * बैनर पर दिखने वाला मुख्य टेक्स्ट
     */
    title: {
        type: String,
        trim: true,
        default: 'Promotional Banner',
    },

    /**
     * बैनर पर क्लिक करने पर रीडायरेक्ट लिंक
     */
    link: {
        type: String,
        trim: true,
        default: '#',
    },

    // --- PLACEMENT ---

    /**
     * बैनर का स्थान/पेज (Page Placement)
     * यह फ़ील्ड बताता है कि बैनर किस विशिष्ट UI स्थान पर उपयोग किया जाएगा।
     */
    placement: {
        type: String,
        enum: [
            'HomePageSlider',       // होमपेज का मुख्य स्लाइडर
            'HomePageBottomPromo',  // होमपेज पर नीचे का छोटा प्रोमो
            'CategoryTop',          // कैटेगरी लिस्ट के ऊपर
            'SearchPageAd',         // खोज परिणाम पेज पर विज्ञापन
            'CheckoutPromo'         // चेकआउट प्रक्रिया में दिखने वाला प्रोमो
        ],
        default: 'HomePageSlider',
        required: true,
    },

    // --- METADATA ---

    /**
     * बैनर की स्थिति
     */
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active',
    },

}, {
    timestamps: true, // createdAt और updatedAt फ़ील्ड्स को जोड़ता है
});

// Export the model
module.exports = mongoose.model('Banner', bannerSchema);
