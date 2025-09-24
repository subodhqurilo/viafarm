// controllers/adminController.js

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Banner = require('../models/Banner');
const Category = require('../models/Category'); // <-- New Import
const { upload } = require('../services/cloudinaryService');

// Other admin functions (getAllUsers, getAllProducts, etc.)

// --- Category Management ---
exports.addCategory = async (req, res) => {
    const { name } = req.body;
    try {
        const newCategory = new Category({ name });
        await newCategory.save();
        res.status(201).json({ message: 'Category added successfully.', category: newCategory });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find();
        res.status(200).json(categories);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.updateCategory = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
        const updatedCategory = await Category.findByIdAndUpdate(id, { name }, { new: true });
        if (!updatedCategory) {
            return res.status(404).json({ message: 'Category not found.' });
        }
        res.status(200).json({ message: 'Category updated successfully.', category: updatedCategory });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.deleteCategory = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedCategory = await Category.findByIdAndDelete(id);
        if (!deletedCategory) {
            return res.status(404).json({ message: 'Category not found.' });
        }
        res.status(200).json({ message: 'Category deleted successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// --- User Management ---
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password'); // don’t return password
        res.status(200).json(users);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.updateUserRole = async (req, res) => {
    const { userId, role } = req.body;
    try {
        const user = await User.findByIdAndUpdate(userId, { role }, { new: true });
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.status(200).json({ message: 'User role updated successfully.', user });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// --- Product Management ---
exports.getAllProducts = async (req, res) => {
    try {
        const products = await Product.find().populate('category', 'name');
        res.status(200).json(products);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// --- Order Management ---
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find().populate('user', 'name email');
        res.status(200).json(orders);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// --- Banner Management ---
exports.addBanner = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No image uploaded.' });

        const banner = new Banner({ imageUrl: req.file.path });
        await banner.save();

        res.status(201).json({ message: 'Banner added successfully.', banner });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.getAllBanners = async (req, res) => {
    try {
        const banners = await Banner.find();
        res.status(200).json(banners);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.updateBanner = async (req, res) => {
    const { id } = req.params;
    try {
        const banner = await Banner.findById(id);
        if (!banner) return res.status(404).json({ message: 'Banner not found.' });

        if (req.file) banner.imageUrl = req.file.path;
        await banner.save();

        res.status(200).json({ message: 'Banner updated successfully.', banner });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.deleteBanner = async (req, res) => {
    const { id } = req.params;
    try {
        const banner = await Banner.findByIdAndDelete(id);
        if (!banner) return res.status(404).json({ message: 'Banner not found.' });
        res.status(200).json({ message: 'Banner deleted successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
