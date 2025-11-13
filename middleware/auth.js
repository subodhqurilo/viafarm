const jwt = require('jsonwebtoken');
const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No authorization header' });
  const parts = header.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid auth header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // should contain user id etc
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
module.exports = { authenticate };