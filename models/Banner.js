const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    
    imageUrl: {
        type: String,
        required: true,
    },

    
    public_id: {
        type: String,
        required: true,
    },

    
    title: {
        type: String,
        trim: true,
        default: 'Promotional Banner',
    },

    
    link: {
        type: String,
        trim: true,
        default: '#',
    },

    
    placement: {
        type: String,
        enum: [
            'HomePageSlider',       
            'HomePageBottomPromo',  
            'CategoryTop',          
            'SearchPageAd',         
            'CheckoutPromo'         
        ],
        default: 'HomePageSlider',
        required: true,
    },

    

    
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active',
    },

}, {
    timestamps: true, 
});


module.exports = mongoose.model('Banner', bannerSchema);
