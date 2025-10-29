// services/emailService.js
const nodemailer = require('nodemailer');

// Create transporter using environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g., smtp.gmail.com
  port: process.env.SMTP_PORT, // e.g., 587
  secure: false, // true for port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Function to send email
const sendEmail = async ({ email, subject, message }) => {
  try {
    await transporter.sendMail({
      from: `"Your App Name" <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      text: message,
    });
  } catch (error) {
    console.error('Email sending error:', error);
    throw new Error(error);
  }
};

module.exports = sendEmail;
