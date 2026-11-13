// SMS provider adapter. In production, implement send() with a provider such
// as MSG91, Twilio or a DLT-registered Indian SMS gateway. The dev build logs
// the OTP to the server console only when ANNPURNN_DEV_OTP is not disabled.
const config = require('./config');

function send(phone, code) {
  if (config.devOtp) {
    console.log(`[ANNPURNN][dev-otp] OTP for ${phone}: ${code}`);
    return;
  }
  throw new Error('SMS provider not configured. Implement server/lib/otp-sender.js send().');
}

module.exports = { send };
