// services/emailService.js

const nodemailer = require('nodemailer');
require('dotenv').config();

// Nodemailer Transporter कॉन्फ़िगरेशन (SendGrid SMTP के लिए)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.sendgrid.net
  port: process.env.SMTP_PORT, // 587
  secure: false, // 587 के लिए FALSE (STARTTLS)
  auth: {
    user: process.env.SMTP_USER, // apikey
    pass: process.env.SMTP_PASS, // SendGrid API Key
  },
    tls: {
        rejectUnauthorized: false
    }
});

// Function to send email
const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      // ⚠️ SendGrid में यह ईमेल Verified होना चाहिए
      from: `ViaFarm <subodh.qurilo@gmail.com>`, 
      to: email,
      subject: subject,
      text: message,
    });

    console.log('✅ Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message); 
  }
};

module.exports = sendEmail;