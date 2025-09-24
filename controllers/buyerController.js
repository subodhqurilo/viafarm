// controllers/buyerController.js

const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const Wishlist = require('../models/Wishlist');
const Address = require('../models/Address');
const Banner = require('../models/Banner'); // For home screen banners

// ===========================
// Home Screen
// ===========================
exports.getHomeScreenData = async (req, res) => {
  try {
    const products = await Product.find().populate('vendor', 'name').limit(10);
    const banners = await Banner.find();
    res.status(200).json({ products, banners });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Get single product details
exports.getProductDetails = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('vendor', 'name');
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ===========================
// Cart Management
// ===========================
exports.addItemToCart = async (req, res) => {
  const { productId, quantity } = req.body;
  const userId = req.user.id;

  try {
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    let cart = await Cart.findOne({ user: userId });
    if (!cart) cart = new Cart({ user: userId, items: [] });

    const itemIndex = cart.items.findIndex(item => item.product.toString() === productId);
    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({ product: productId, quantity, price: product.price });
    }

    await cart.save();
    res.status(200).json({ message: 'Item added to cart.', cart });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getCartItems = async (req, res) => {
  const userId = req.user.id;
  try {
    const cart = await Cart.findOne({ user: userId }).populate('items.product', 'name price images');
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });
    res.status(200).json(cart);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.removeItemFromCart = async (req, res) => {
  const { productId } = req.params;
  const userId = req.user.id;
  try {
    let cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });

    cart.items = cart.items.filter(item => item.product.toString() !== productId);
    await cart.save();

    res.status(200).json({ message: 'Item removed from cart.', cart });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ===========================
// Orders
// ===========================
exports.createOrder = async (req, res) => {
  const userId = req.user.id;
  const { addressId, paymentMethod } = req.body;

  try {
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || cart.items.length === 0) return res.status(400).json({ message: 'Cart is empty.' });

    const shippingAddress = await Address.findById(addressId);
    if (!shippingAddress) return res.status(404).json({ message: 'Shipping address not found.' });

    const orderItems = cart.items.map(item => ({
      product: item.product._id,
      quantity: item.quantity,
      price: item.product.price,
      vendor: item.product.vendor
    }));

    const totalPrice = orderItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

    const order = new Order({
      user: userId,
      orderItems,
      shippingAddress: {
        address: shippingAddress.address,
        city: shippingAddress.city,
        postalCode: shippingAddress.postalCode
      },
      paymentMethod,
      totalPrice
    });

    await order.save();
    await Cart.findOneAndDelete({ user: userId });

    res.status(201).json({ message: 'Order created successfully.', order });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getOrders = async (req, res) => {
  const userId = req.user.id;
  try {
    const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ===========================
// Profile Management
// ===========================
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, mobileNumber, email, profileImage, socialMedia } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.name = name || user.name;
    user.mobileNumber = mobileNumber || user.mobileNumber;
    user.email = email || user.email;
    user.profileImage = profileImage || user.profileImage;

    if (socialMedia) user.socialMedia = { ...user.socialMedia, ...socialMedia };

    await user.save();
    res.status(200).json({ message: 'Profile updated successfully.', user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ===========================
// Address Management
// ===========================
exports.addAddress = async (req, res) => {
  const { address, city, postalCode } = req.body;

  try {
    const newAddress = new Address({
      user: req.user.id,
      address,
      city,
      postalCode
    });

    await newAddress.save();
    res.status(201).json({ message: 'Address added successfully.', address: newAddress });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getAddresses = async (req, res) => {
  try {
    const addresses = await Address.find({ user: req.user.id });
    res.status(200).json(addresses);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ===========================
// Wishlist Management
// ===========================
exports.addToWishlist = async (req, res) => {
  const { productId } = req.body;

  try {
    let wishlist = await Wishlist.findOne({ user: req.user.id });
    if (!wishlist) wishlist = new Wishlist({ user: req.user.id, products: [] });

    if (!wishlist.products.includes(productId)) wishlist.products.push(productId);

    await wishlist.save();
    res.status(200).json({ message: 'Product added to wishlist.', wishlist });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user.id }).populate('products', 'name price images');
    res.status(200).json(wishlist);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
