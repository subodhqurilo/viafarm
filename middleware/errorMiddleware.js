// middleware/errorHandler.js

module.exports = (err, req, res, next) => {
  // Log the error for server-side debugging
  console.error(err.stack);

  // Set a default status code and message
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Server error occurred.';

  // Send the error response
  res.status(statusCode).json({
    success: false,
    message: message,
    // In a production environment, you might not want to send the full error stack
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};