const jwt = require("jsonwebtoken");
const User = require("../models/User");

// COOKIE-BASED Authentication Middleware
const authMiddleware = async (req, res, next) => {
  try {
    // ⭐ Read token from HTTP-ONLY cookie
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "Authentication required. Token missing." });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from DB
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User does not exist anymore." });
    }

    // Attach to request
    req.user = user;

    next();

  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

// ROLE-BASED AUTH
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied: You do not have permission.",
      });
    }
    next();
  };
};

module.exports = { authMiddleware, authorizeRoles };
