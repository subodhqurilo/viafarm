
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Basic authentication middleware


const authMiddleware = async (req, res, next) => {
  const token = req.header('x-auth-token') || req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'No token, authorization denied.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // { id, role }

    // Fetch full user from DB
    const user = await User.findById(decoded.id).select('-password'); 
    if (!user) return res.status(401).json({ message: 'User not found.' });

    req.user = user; // now req.user has _id, name, role, etc.
    next();
  } catch (err) {
      console.error(err); // log reason

    res.status(401).json({ message: 'Token is not valid.' });
  }
};




// Role-based authorization middleware
const authorizeRoles = (...allowedRoles) => {
    console.log("j",allowedRoles)
  return (req, res, next) => {
        console.log('Decoded user:', req.user.role); // <-- check what role is

    if (!req.user || !allowedRoles.includes(req.user.role)) {
          console.log('User role not allowed:', req.user.role, 'Allowed roles:', allowedRoles);
[]
      return res.status(403).json({ message: `Access denied: ${req.user.role}` });
    }
    next();
  };
};

module.exports = { authMiddleware, authorizeRoles };
