// SMS provider adapter for OTP delivery.
//
// Choose a provider with environment variables (no npm dependencies — uses
// the built-in fetch):
//
//   MSG91 (popular in India, needs a DLT-approved OTP template):
//     ANNPURNN_SMS_PROVIDER = msg91
//     MSG91_AUTH_KEY        = <your authkey from control.msg91.com>
//     MSG91_SENDER_ID       = <6-char DLT sender ID, e.g. ANNPUR>
//     MSG91_TEMPLATE_ID     = <DLT-approved OTP template id using ##OTP##>
//
//   Twilio:
//     ANNPURNN_SMS_PROVIDER = twilio
//     TWILIO_ACCOUNT_SID    = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//     TWILIO_AUTH_TOKEN     = <auth token>
//     TWILIO_FROM           = <purchased number or Messaging Service SID>
//
// With no provider configured, the dev behaviour applies: the OTP is printed
// in the server console (and shown in the app) when ANNPURNN_DEV_OTP != 0.
const config = require('./config');

function providerName() {
  if (config.sms.provider) return config.sms.provider;
  if (config.sms.msg91AuthKey) return 'msg91';
  if (config.sms.twilioSid && config.sms.twilioToken) return 'twilio';
  return null;
}

async function sendMsg91(phone, code) {
  const url = 'https://control.msg91.com/api/v5/otp?' + new URLSearchParams({
    template_id: config.sms.msg91TemplateId,
    mobile: phone.replace('+91', '91'), // MSG91 wants 91XXXXXXXXXX
    otp: code
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { authkey: config.sms.msg91AuthKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ OTP: code })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.type && data.type === 'error')) {
    throw new Error(`MSG91 SMS failed: ${data.message || res.status}`);
  }
}

async function sendTwilio(phone, code) {
  const sid = config.sms.twilioSid;
  const params = new URLSearchParams({
    To: phone,
    From: config.sms.twilioFrom,
    Body: `${code} is your ANNPURNN verification code. It is valid for ${config.otpTtlMinutes} minutes. Never share this code.`
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${config.sms.twilioToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Twilio SMS failed: ${data.message || res.status}`);
  }
}

// Sends the OTP through the configured provider. Throws (so the API can
// return a clear error) when a provider is set but delivery fails.
async function send(phone, code) {
  const provider = providerName();
  console.log(`[ANNPURNN][otp] OTP for ${phone}: ${code}${provider ? ` (via ${provider})` : ' (dev mode — no SMS provider configured)'}`);
  if (!provider) {
    if (config.devOtp) return; // dev: OTP is returned in the API response
    throw new Error('SMS provider not configured. Set ANNPURNN_SMS_PROVIDER with MSG91 or Twilio credentials.');
  }
  if (provider === 'msg91') return sendMsg91(phone, code);
  if (provider === 'twilio') return sendTwilio(phone, code);
  throw new Error(`Unknown SMS provider: ${provider}`);
}

module.exports = { send, providerName };
