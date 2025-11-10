// services/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// ✅ Gmail SMTP transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.gmail.com
  port: process.env.SMTP_PORT, // 465 or 587
  secure: process.env.SMTP_PORT == 465, // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER, // your Gmail address
    pass: process.env.SMTP_PASS, // your Gmail App Password
  },
});

// ✅ Function to send email
const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: `ViaFarm <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      html: message,
    });

    console.log('✅ Email sent via Gmail SMTP:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message);
  }
};

module.exports = sendEmail;
