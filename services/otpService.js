const axios = require("axios");
require("dotenv").config();

/**
 * Generate OTP (4-digit)
 */
exports.generateOTP = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

/**
 * Send OTP via Autobysms API
 */
exports.sendOTP = async (mobile, otp) => {
  try {
    const API_KEY = process.env.AUTOBYSMS_API_KEY;
    const SENDER_ID = process.env.AUTOBYSMS_SENDER_ID;
    const TEMPLATE_ID = process.env.AUTOBYSMS_TEMPLATE_ID;

    let phone = mobile;
    if (phone.startsWith("+91")) phone = phone.slice(3);
    if (phone.length === 10) phone = "91" + phone;

    const message = encodeURIComponent(`Your OTP is ${otp} SELECTIAL`);
    const apiUrl = `https://sms.autobysms.com/app/smsapi/index.php?key=${API_KEY}&campaign=0&routeid=9&type=text&contacts=${phone}&senderid=${SENDER_ID}&msg=${message}&template_id=${TEMPLATE_ID}`;

    const response = await axios.get(apiUrl);

    console.log("📩 SMS API Raw Response:", response.data);

    if (
      response.data?.status === "OK" ||
      response.data?.type === "SUCCESS" ||
      (typeof response.data === "string" && response.data.includes("SUCCESS"))
    ) {
      console.log(`✅ OTP (${otp}) sent successfully to ${mobile}`);
      return true;
    } else {
      console.error("❌ SMS sending failed:", response.data);
      return false;
    }
  } catch (error) {
    console.error("❌ OTP sending error:", error.message);
    if (error.response) console.error("API Error Response:", error.response.data);
    return false;
  }
};
