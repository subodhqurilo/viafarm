const axios = require("axios");
require("dotenv").config();

const sendEmailOTP = async (to, otp) => {
  const subject = "Your ViaFarm OTP Code";
  const html = `
    <div style="font-family: Arial, sans-serif; font-size:16px;">
      <h2>🔐 Your ViaFarm OTP</h2>
      <p>Your OTP is: <b style="font-size:20px;">${otp}</b></p>
      <p>This code will expire in 5 minutes.</p>
      <p style="margin-top:20px;">If you didn’t request this, please ignore this email.</p>
    </div>
  `;

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "ViaFarm", email: process.env.EMAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ OTP Email sent via Brevo:", response.data);
    return true;
  } catch (error) {
    console.error("❌ OTP email failed:", error.response?.data || error.message);
    return false;
  }
};

module.exports = { sendEmailOTP };
