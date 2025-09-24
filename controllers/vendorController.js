const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Category = require('../models/Category');
const { upload } = require('../services/cloudinaryService');

// -------------------------
// Dashboard Anala
// -------------------------
exports.getDashboardData = async (req, res) => {
  const vendorId = req.user.id;
  try {
    const totalProducts = await Product.countDocuments({ vendor: vendorId });
    const allOrders = await Order.find({ 'orderItems.vendor': vendorId, orderStatus: 'Delivered' });
    const allRevenue = allOrders.reduce((total, order) => {
      const vendorItems = order.orderItems.filter(item => item.vendor.toString() === vendorId);
      return total + vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }, 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = await Order.find({ 'orderItems.vendor': vendorId, createdAt: { $gte: startOfToday } });
    const todayRevenue = todayOrders.reduce((total, order) => {
      const vendorItems = order.orderItems.filter(item => item.vendor.toString() === vendorId);
      return total + vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }, 0);

    const totalCustomers = await User.countDocuments({ role: 'buyer' });

    res.status(200).json({
      totalProducts,
      totalOrders: allOrders.length,
      totalRevenue: allRevenue,
      todayOrders: todayOrders.length,
      todayRevenue,
      totalCustomers
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// -------------------------
// Product Management
// -------------------------
exports.addProduct = async (req, res) => {
  const { name, category, variety, price, quantity, unit, description } = req.body;
  const vendorId = req.user.id;
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ message: 'At least one image is required.' });

    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) return res.status(404).json({ message: 'Category not found.' });

    const imageUrls = req.files.map(file => file.path);
    const newProduct = await Product.create({
      name,
      category,
      variety,
      price,
      quantity,
      unit,
      description,
      images: imageUrls,
      vendor: vendorId
    });

    res.status(201).json({ message: 'Product added successfully', product: newProduct });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getVendorProducts = async (req, res) => {
  const vendorId = req.user.id;
  try {
    const products = await Product.find({ vendor: vendorId })
      .populate('category', 'name')
      .select('name category variety price quantity unit images description');
    res.status(200).json({ products });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, category, variety, price, quantity, unit, description } = req.body;
  const vendorId = req.user.id;
  try {
    const product = await Product.findOne({ _id: id, vendor: vendorId });
    if (!product) return res.status(404).json({ message: 'Product not found or not owned by you.' });

    if (category) {
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc) return res.status(404).json({ message: 'Category not found.' });
    }

    product.name = name || product.name;
    product.category = category || product.category;
    product.variety = variety || product.variety;
    product.price = price || product.price;
    product.quantity = quantity || product.quantity;
    product.unit = unit || product.unit;
    product.description = description || product.description;

    if (req.files && req.files.length > 0) {
      product.images = req.files.map(file => file.path);
    }

    await product.save();
    res.status(200).json({ message: 'Product updated successfully', product });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  const vendorId = req.user.id;
  try {
    const product = await Product.findOneAndDelete({ _id: id, vendor: vendorId });
    if (!product) return res.status(404).json({ message: 'Product not found or not owned by you.' });
    res.status(200).json({ message: 'Product deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// -------------------------
// Order Management
// -------------------------
exports.getVendorOrders = async (req, res) => {
  const vendorId = req.user.id;
  try {
    const orders = await Order.find({ 'orderItems.vendor': vendorId }).populate('user', 'name email mobileNumber');
    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { orderStatus } = req.body;
  const vendorId = req.user.id;
  try {
    const order = await Order.findOne({ _id: id, 'orderItems.vendor': vendorId });
    if (!order) return res.status(404).json({ message: 'Order not found or you are not a vendor for this order.' });

    order.orderStatus = orderStatus;
    await order.save();

    res.status(200).json({ message: `Order status updated to ${orderStatus}`, order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// -------------------------
// Profile Management
// -------------------------
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.status(200).json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, email, farmName, socialMedia } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.name = name || user.name;
    user.email = email || user.email;
    user.farmName = farmName || user.farmName;
    user.socialMedia = socialMedia || user.socialMedia;

    await user.save();
    res.status(200).json({ message: 'Profile updated successfully', user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
