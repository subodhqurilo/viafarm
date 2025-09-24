const jwt = require('jsonwebtoken');

// Basic authentication middleware
const authMiddleware = (req, res, next) => {
  const token = req.header('x-auth-token') || req.headers.authorization?.split(' ')[1]; 
  // Supports both "x-auth-token" and "Authorization: Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid.' });
  }
};

// Role-based authorization middleware
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
        console.log('Decoded user:', req.user); // <-- check what role is

    if (!req.user || !allowedRoles.includes(req.user.role)) {
          console.log('User role not allowed:', req.user.role, 'Allowed roles:', allowedRoles);

      return res.status(403).json({ message: 'Access denied: insufficient role permissions.' });
    }
    next();
  };
};

module.exports = { authMiddleware, authorizeRoles };
