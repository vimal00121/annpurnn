const path = require('node:path');

const config = {
  appName: 'ANNPURNN',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dbFile: process.env.ANNPURNN_DB || path.join(__dirname, '..', '..', 'data', 'annpurnn.db'),
  uploadDir: process.env.ANNPURNN_UPLOADS || path.join(__dirname, '..', '..', 'data', 'uploads'),

  // Session / crypto
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24 * 14),
  secret: process.env.ANNPURNN_SECRET || 'dev-only-secret-change-me',

  // OTP: in development the OTP is returned in the API response so the app is
  // testable without an SMS provider. In production set ANNPURNN_DEV_OTP=0 and
  // plug a provider into server/lib/otp-sender.js.
  devOtp: process.env.ANNPURNN_DEV_OTP !== '0',
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,

  // Real SMS delivery (optional). Set ANNPURNN_SMS_PROVIDER to msg91 or
  // twilio with the matching credentials to send OTPs by SMS.
  sms: {
    provider: process.env.ANNPURNN_SMS_PROVIDER || null,
    msg91AuthKey: process.env.MSG91_AUTH_KEY || null,
    msg91SenderId: process.env.MSG91_SENDER_ID || null,
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID || null,
    twilioSid: process.env.TWILIO_ACCOUNT_SID || null,
    twilioToken: process.env.TWILIO_AUTH_TOKEN || null,
    twilioFrom: process.env.TWILIO_FROM || null
  },

  // Email OTP delivery (optional). Resend or any SMTP server.
  email: {
    resendKey: process.env.RESEND_API_KEY || null,
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: Number(process.env.SMTP_PORT || 465),
    smtpUser: process.env.SMTP_USER || null,
    smtpPass: process.env.SMTP_PASS || null,
    from: process.env.EMAIL_FROM || null
  },

  // Abuse prevention defaults
  maxOpenRequestsPerUser: 3,
  duplicateWindowHours: 12,
  maxMessagesPerMinute: 10,
  maxReportsPerDay: 10,

  city: 'Surat',
  defaultLang: 'en'
};

module.exports = config;
