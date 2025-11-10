// services/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// ✅ Brevo SMTP transporter (real inbox delivery)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // Brevo uses TLS (port 587)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ✅ Function to send emails
const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: `ViaFarm <${process.env.EMAIL_FROM}>`,
      to: email,
      subject,
      html: message,
      text: message.replace(/<[^>]*>/g, ''), // fallback plain text
    });

    console.log('✅ Email sent via Brevo:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message);
  }
};

module.exports = sendEmail;
