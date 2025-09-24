// services/otpService.js

const crypto = require('crypto');

/**
 * Generates a 6-digit OTP.
 * @returns {string} The generated OTP.
 */
exports.generateOTP = () => {
  // Generate a random 6-digit number and pad with leading zeros if necessary
const otp = Math.floor(1000 + Math.random() * 9000);
  return otp.toString();
};

/**
 * Sends an OTP to a mobile number (mock function).
 * @param {string} mobileNumber The mobile number to send the OTP to.
 * @param {string} otp The OTP to be sent.
 */
exports.sendOTP = async (mobileNumber, otp) => {
  // In a real application, you would use an SMS provider here.
  // Example: Twilio, Vonage, etc.
  console.log(`Sending OTP ${otp} to ${mobileNumber}`);

  // You would typically make an API call to the service here.
  // const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await client.messages.create({
  //   body: `Your verification code is ${otp}`,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: mobileNumber,
  // });
};