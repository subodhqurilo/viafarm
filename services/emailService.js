const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: 'ViaFarm <no-reply@viafarm.com>', // ✅ use this
      to: email,
      subject,
      text: message.replace(/<[^>]*>/g, ''), // plain text fallback
      html: message
    });

    console.log('✅ Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    throw new Error(error.message);
  }
};

module.exports = sendEmail;
