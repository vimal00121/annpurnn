// Email provider adapter for OTP delivery (email login).
//
// Providers, chosen automatically by which environment variables are set:
//
//   Resend (simplest — https://resend.com, free tier):
//     RESEND_API_KEY = re_xxxxxxxx
//     EMAIL_FROM     = "ANNPURNN" <login@yourdomain.com>   (or onboarding@resend.dev for testing)
//
//   Any SMTP server (Gmail, Zoho, your own):
//     SMTP_HOST      = smtp.gmail.com
//     SMTP_PORT      = 465
//     SMTP_USER      = you@gmail.com
//     SMTP_PASS      = <app password>   (Gmail: account must have 2FA + app password)
//     EMAIL_FROM     = you@gmail.com
//
// With no provider configured, the dev behaviour applies: the code is printed
// in the server console (and shown in the app) when ANNPURNN_DEV_OTP != 0.
const tls = require('node:tls');
const config = require('./config');

function providerName() {
  if (config.email.resendKey) return 'resend';
  if (config.email.smtpHost && config.email.smtpUser && config.email.smtpPass) return 'smtp';
  return null;
}

function otpEmail(code) {
  return {
    subject: `${code} is your ANNPURNN login code`,
    text: `Your ANNPURNN verification code is ${code}. It is valid for ${config.otpTtlMinutes} minutes. Never share this code.`,
    html: `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:12px">
      <h2 style="color:#1b5e20;margin:0 0 8px">अन्न ब्रह्म है |</h2>
      <p>Your ANNPURNN verification code:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1b5e20">${code}</p>
      <p style="color:#666">Valid for ${config.otpTtlMinutes} minutes. Never share this code with anyone.</p>
    </div>`
  };
}

async function sendResend(email, code) {
  const body = otpEmail(code);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.email.from, to: [email], subject: body.subject, html: body.html })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Resend email failed: ${data.message || res.status}`);
  }
}

// Minimal SMTP client (implicit TLS on 465 or STARTTLS on 587).
function sendSmtp(email, code) {
  return new Promise((resolve, reject) => {
    const port = config.email.smtpPort || 465;
    const body = otpEmail(code);
    const from = (config.email.from || config.email.smtpUser).replace(/.*<|>.*/g, '');
    const msg = [
      `From: ${config.email.from || config.email.smtpUser}`,
      `To: ${email}`,
      `Subject: ${body.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      body.html
    ].join('\r\n');

    const steps = [
      { expect: /^220/, send: () => 'EHLO annpurnn\r\n' },
      { expect: /^250/, send: () => 'AUTH LOGIN\r\n' },
      { expect: /^334/, send: () => Buffer.from(config.email.smtpUser).toString('base64') + '\r\n' },
      { expect: /^334/, send: () => Buffer.from(config.email.smtpPass).toString('base64') + '\r\n' },
      { expect: /^235/, send: () => `MAIL FROM:<${from}>\r\n` },
      { expect: /^250/, send: () => `RCPT TO:<${email}>\r\n` },
      { expect: /^250/, send: () => 'DATA\r\n' },
      { expect: /^354/, send: () => msg + '\r\n.\r\n' },
      { expect: /^250/, send: () => 'QUIT\r\n' }
    ];
    let step = 0;
    let buffer = '';

    const socket = port === 465
      ? tls.connect({ host: config.email.smtpHost, port, servername: config.email.smtpHost })
      : require('node:net').connect({ host: config.email.smtpHost, port });

    const fail = (err) => { socket.destroy(); reject(new Error(`SMTP email failed: ${err.message}`)); };
    socket.setTimeout(15000, () => fail(new Error('SMTP connection timed out')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!/\r?\n$/.test(buffer)) return; // wait for the full reply
      const line = buffer; buffer = '';
      const s = steps[step];
      if (!s || !s.expect.test(line)) return fail(new Error(`unexpected reply at step ${step}: ${line.trim().slice(0, 120)}`));
      const out = s.send();
      step++;
      if (out) socket.write(out);
      else { socket.end(); resolve(); }
    });
  });
}

// Sends the OTP email. Throws on provider failure so the API can return a
// clear error instead of silently swallowing the code.
async function send(email, code) {
  const provider = providerName();
  console.log(`[ANNPURNN][otp] Email OTP for ${email}: ${code}${provider ? ` (via ${provider})` : ' (dev mode — no email provider configured)'}`);
  if (!provider) {
    if (config.devOtp) return; // dev: code is returned in the API response
    throw new Error('Email provider not configured. Set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.');
  }
  if (provider === 'resend') return sendResend(email, code);
  return sendSmtp(email, code);
}

module.exports = { send, providerName };
