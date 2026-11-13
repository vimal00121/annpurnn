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

  // Abuse prevention defaults
  maxOpenRequestsPerUser: 3,
  duplicateWindowHours: 12,
  maxMessagesPerMinute: 10,
  maxReportsPerDay: 10,

  city: 'Surat',
  defaultLang: 'en'
};

module.exports = config;
