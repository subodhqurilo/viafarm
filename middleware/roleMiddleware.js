// middleware/roleMiddleware.js

module.exports = (roles) => (req, res, next) => {
    console.log("h",roles)
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access forbidden: You do not have the required permissions' });
  }
  next();
};