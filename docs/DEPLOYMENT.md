# Deployment Instructions

## Requirements
- Node.js ≥ 22.13 (uses built-in `node:sqlite`)
- No npm packages to install — zero runtime dependencies

## Local run

```bash
npm test          # 22 API tests
npm run seed      # demo data + admin account
npm start         # http://127.0.0.1:3000
```

Open the app at `http://localhost:3000` and the admin dashboard at `http://localhost:3000/admin`.
In dev mode (`ANNPURNN_DEV_OTP` unset/`1`) the OTP is printed to the server console **and** returned by the OTP API for easy testing. Seeded accounts: admin `+919800000009`, donor `+919800000002`, seeker `+919800000001`, helper `+919800000004`.

## Production (single VM, e.g. a ₹500/mo Indian VPS)

```bash
# 1. Get the code onto the server
git clone <your-repo-url> /opt/annpurnn && cd /opt/annpurnn

# 2. Environment (put in /etc/annpurnn.env, chmod 600)
cat > /etc/annpurnn.env <<'EOF'
PORT=3000
HOST=127.0.0.1
ANNPURNN_SECRET=<openssl rand -hex 32>
ANNPURNN_DB=/var/lib/annpurnn/annpurnn.db
ANNPURNN_UPLOADS=/var/lib/annpurnn/uploads
ANNPURNN_DEV_OTP=0
EOF

# 3. Systemd service
cat > /etc/systemd/system/annpurnn.service <<'EOF'
[Unit]
Description=ANNPURNN food-sharing server
After=network.target

[Service]
User=annpurnn
EnvironmentFile=/etc/annpurnn.env
ExecStart=/usr/bin/node /opt/annpurnn/server/index.js
Restart=always
HardeningProtectSystem=full
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl enable --now annpurnn
```

## TLS + reverse proxy (Nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name annpurnn.example.org;
  ssl_certificate     /etc/letsencrypt/live/annpurnn.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/annpurnn.example.org/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;
  }
}
```
Issue certificates with `certbot`. Never expose the Node port directly.

## Production hardening checklist
- [ ] `ANNPURNN_SECRET` = long random value; rotate never casually (it derives OTP hashes).
- [ ] `ANNPURNN_DEV_OTP=0` and configure a real SMS provider (see below).
- [ ] Nightly backup: `sqlite3 /var/lib/annpurnn/annpurnn.db ".backup /backups/$(date +%F).db"` + upload off-site.
- [ ] Log rotation for journald; ship audit_log to your SIEM if available.
- [ ] Data-retention policy: delete `otp_codes` older than 1 day, old rate-limit windows (automatic), expired sessions weekly.
- [ ] Publish Privacy Policy + Terms + grievance-officer contact (Indian intermediary rules).
- [ ] Set up uptime monitoring and a staging environment.

## Android app (future)
The backend is API-first: authenticate with `POST /api/auth/otp/verify` and send the returned token as `Authorization: Bearer <token>` on every call — exactly what the web SPA does. Add FCM push by extending `server/lib/db.js#notify()`.

## Real SMS OTP delivery

Without a provider, the app runs in dev mode: the OTP is shown on the login screen and printed in the server logs — no SMS is sent. To deliver OTPs to real phones, add these environment variables:

**MSG91 (recommended for India — requires DLT registration for your sender ID and OTP template):**

```
ANNPURNN_SMS_PROVIDER = msg91
MSG91_AUTH_KEY        = <authkey from control.msg91.com>
MSG91_SENDER_ID       = <6-char DLT sender ID, e.g. ANNPUR>
MSG91_TEMPLATE_ID     = <DLT-approved OTP template id using ##OTP##>
```

**Twilio:**

```
ANNPURNN_SMS_PROVIDER = twilio
TWILIO_ACCOUNT_SID    = ACxxxxxxxx...
TWILIO_AUTH_TOKEN     = <auth token>
TWILIO_FROM           = <purchased number or Messaging Service SID>
```

When a provider is configured, the OTP is never returned by the API or shown on screen — it is only sent by SMS. Delivery failures return a clear error to the user instead of silently swallowing the code. Note: transactional SMS to Indian numbers legally requires DLT registration (see docs/FOOD_SAFETY.md launch checklist).

## Scaling path
1. PostgreSQL: swap `server/lib/db.js` (queries are already simple SQL).
2. Redis for rate limits/sessions if you run multiple Node processes.
3. S3-compatible object storage for photos; CDN for static assets.
4. Put the API behind a load balancer; keep admin dashboard on a separate hostname/IP allow-list if desired.
