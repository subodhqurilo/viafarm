// services/emailService.js

const nodemailer = require('nodemailer');
// dotenv को यहां भी require करना सुनिश्चित करें यदि यह किसी अन्य फ़ाइल से import नहीं हो रहा है
require('dotenv').config(); // अगर .env variables लोड नहीं हो रहे हैं

// 💡 Nodemailer Transporter कॉन्फ़िगरेशन में सुधार
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true, // 💡 पोर्ट 465 के लिए इसे TRUE होना चाहिए!
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // port 465 (secure: true) के साथ 'tls' सेटिंग्स की आवश्यकता नहीं है
});

// Function to send email
const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: `ViaFarm <${process.env.SMTP_USER}>`,
      to: email,
      subject: subject,
      text: message,
    });

    console.log('✅ Email sent successfully:', info.messageId);
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message); // केवल error.message को throw करें
  }
};

module.exports = sendEmail;