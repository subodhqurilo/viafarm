const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT == 465, // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, // avoid TLS issues on some servers
  },
});

const sendEmail = async ({ email, subject, message }) => {
  try {
    const info = await transporter.sendMail({
      from: `ViaFarm <${process.env.EMAIL_FROM}>`,
      to: email,
      subject,
      html: message,
    });

    console.log("✅ Email sent successfully:", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Email sending error:", error.message);
    throw error;
  }
};

module.exports = sendEmail;
