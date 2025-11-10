// services/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// ✅ Mailtrap SMTP configuration
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER, // using env vars is safer
    pass: process.env.MAILTRAP_PASS
  }
});

// ✅ Function to send email
const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: 'ViaFarm <no-reply@viafarm.com>',
      to: email,
      subject: subject,
      text: message,
      html: `<p>${message}</p>`
    });

    console.log('✅ Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message);
  }
};

module.exports = sendEmail;
