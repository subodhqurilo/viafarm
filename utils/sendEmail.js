const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ email, subject, message }) => {
  try {
    const response = await resend.emails.send({
      from: 'subodhkumar2520@gmail.com', // must be verified sender domain in Resend
      to: email,
      subject,
      text: message,
    });

    console.log('✅ Email sent:', response);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw new Error(error.message);
  }
};

module.exports = sendEmail;
