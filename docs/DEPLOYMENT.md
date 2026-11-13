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
- [ ] `ANNPURNN_DEV_OTP=0` and implement `server/lib/otp-sender.js` with a DLT-registered SMS gateway (MSG91/Twilio).
- [ ] Nightly backup: `sqlite3 /var/lib/annpurnn/annpurnn.db ".backup /backups/$(date +%F).db"` + upload off-site.
- [ ] Log rotation for journald; ship audit_log to your SIEM if available.
- [ ] Data-retention policy: delete `otp_codes` older than 1 day, old rate-limit windows (automatic), expired sessions weekly.
- [ ] Publish Privacy Policy + Terms + grievance-officer contact (Indian intermediary rules).
- [ ] Set up uptime monitoring and a staging environment.

## Android app (future)
The backend is API-first: authenticate with `POST /api/auth/otp/verify` and send the returned token as `Authorization: Bearer <token>` on every call — exactly what the web SPA does. Add FCM push by extending `server/lib/db.js#notify()`.

## Scaling path
1. PostgreSQL: swap `server/lib/db.js` (queries are already simple SQL).
2. Redis for rate limits/sessions if you run multiple Node processes.
3. S3-compatible object storage for photos; CDN for static assets.
4. Put the API behind a load balancer; keep admin dashboard on a separate hostname/IP allow-list if desired.
