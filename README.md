<p align="center">
  <img src="docs/dashboard-overview.png" alt="PiGuard Dashboard" width="900">
</p>

<h1 align="center">PiGuard</h1>

<p align="center">
  <strong>Lightweight, self-hosted monitoring dashboard for Raspberry Pi and Linux hosts.</strong><br>
  One stack. One wizard. Full visibility.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>&nbsp;&middot;&nbsp;
  <a href="#features">Features</a>&nbsp;&middot;&nbsp;
  <a href="#configuration">Configuration</a>&nbsp;&middot;&nbsp;
  <a href="#security-model">Security</a>&nbsp;&middot;&nbsp;
  <a href="#license">License</a>
</p>

---

## About

PiGuard delivers real-time system metrics, Docker visibility, health checks, security auditing, alerting, reverse-proxy analytics, and an optional AI assistant — all from a clean, themeable web dashboard.

Most monitoring stacks are too heavy, too generic, or too painful to bootstrap on a Pi. PiGuard takes a different approach:

1. Start the stack
2. Open the browser
3. Complete the setup wizard
4. Monitor immediately

No manual database setup. No config files to hand-edit. No external dependencies.

---

## Quick Start

```bash
git clone https://github.com/N04H2601/piguard.git && cd piguard
cp .env.example .env
./scripts/up.sh
```

Open `http://<your-pi-ip>:3333` and complete the first-run wizard.

If you prefer raw Compose, run `./scripts/preflight.sh` first so PiGuard can stop early on HTTP port conflicts.

---

## Features

| Category | What you get |
|----------|-------------|
| **System Overview** | CPU, RAM, temperature, uptime, disks (I/O + usage), top processes, network rates — all real-time via WebSocket |
| **Docker** | Container status, per-container CPU/RAM, live logs |
| **Health Checks** | HTTP, TCP, DNS, ICMP probes with uptime history (24h / 7d / 30d / 90d) and configurable intervals |
| **Security** | SSH posture score, firewall rules, fail2ban jails, WireGuard peers, SSL certificate expiry, login history |
| **Alerts** | Threshold-based rules with Telegram and SMTP email delivery |
| **Nginx Analytics** | Access/error log parsing, top URIs, virtual hosts, active WebSocket connections |
| **AI Assistant** | Optional OpenAI-powered operational analysis with persistent conversations |
| **Themes** | Six built-in themes — Cyber, Emerald, Rose, Amber, Hacker, Light |
| **Kiosk Mode** | Full-screen dashboard for wall-mounted displays |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express + TypeScript |
| Frontend | Lit Web Components + Vite |
| Database | SQLite (better-sqlite3) |
| Auth | JWT (jose) + Argon2id |
| Real-time | WebSocket (ws) |
| Runtime | Docker / Docker Compose |

---

## First-Run Wizard

On a fresh install, the dashboard opens into a guided setup flow:

- **Instance name** — displayed in sidebar, login page, and browser tab
- **Admin credentials** — username + strong password (8+ chars with upper, lower, digit, special)
- **Language** — French or English
- **Notifications** — Telegram and/or SMTP email with Gmail, Outlook, or custom provider presets

Everything is stored in SQLite. The wizard auto-signs you in when complete, and health checks can be added later from the app.

---

## Configuration

### Environment (`.env`)

The `.env` file is intentionally minimal — container-level settings only.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3333` | HTTP listen port |
| `NODE_ENV` | `production` | `production` / `development` |
| `TZ` | `UTC` | Container timezone |
| `DB_PATH` | `./data/piguard.db` | SQLite database path |
| `JWT_SECRET` | *(persisted in SQLite if empty)* | JWT signing secret |
| `JWT_EXPIRY` | `24h` | Session duration |
| `LOG_LEVEL` | `info` | Pino log level |
| `COOKIE_SECURE` | `auto` | Cookie Secure flag (`auto` / `true` / `false`) |
| `CORS_ORIGINS` | *(empty = disabled)* | Comma-separated browser origin allowlist |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Trusted reverse-proxy hops / CIDRs for client IP resolution |
| `PIGUARD_HOST_INTEGRATIONS` | `0` | Enable optional host-level collectors when using `./scripts/up.sh` |
| `GEOIP_PATH` | `./data/geoip/...` | MaxMind GeoIP database path |
| `SMTP_HOST` | — | Optional default SMTP host for advanced/custom setups |
| `SMTP_PORT` | `587` | Optional default SMTP port |
| `SMTP_USER` | — | Optional default SMTP username |
| `SMTP_PASS` | — | Optional default SMTP password |
| `SMTP_FROM` | — | Optional default sender address |
| `SMTP_TO` | — | Optional default recipient address |
| `SMTP_TLS` | `true` | Optional default TLS mode |
| `NGINX_CONTAINER_NAME` | `nginx` | Nginx container for log parsing |
| `OPENAI_API_KEY` | — | Enable AI assistant (optional) |
| `OPENAI_MODEL` | `gpt-5.4` | Model for the AI assistant |

### Application Settings

All application settings are managed from the web UI — not from `.env`:

Instance name, language, admin password, notification channels, health checks, alert rules, theme, API keys.

---

## Notification Channels

| Channel | Required Fields |
|---------|----------------|
| **Telegram** | Bot token, chat ID |
| **Email** | Provider preset (Gmail / Outlook / Custom), sender auth, recipient email |

Configurable during setup or later from Settings.

### Gmail Mini-Tutorial

1. Enable 2-Step Verification on the Gmail account you want to use.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords).
3. Create a new app password for PiGuard.
4. In PiGuard, choose `Gmail`, enter your Gmail address, paste the app password, then set the recipient email.
5. Click `Envoyer un test` before saving.

Gmail regular account passwords are not supported here. Use an app password.

---

## Docker Compose

The default `docker-compose.yml` is the safe baseline:

- published port `3333`
- no host PID namespace
- no Docker socket
- no broad host filesystem mount
- non-root runtime user

If you want deeper host observability (Docker, host process list, nginx logs, SSH/auth logs, WireGuard configs), enable the optional override:

```bash
echo "PIGUARD_HOST_INTEGRATIONS=1" >> .env
./scripts/up.sh
```

That loads `docker-compose.host-integrations.yml`, which intentionally grants additional read-only host access, host PID visibility, and Docker socket access. Use it only if you need those widgets.

---

## Reverse Proxy

Works on port `3333` directly or behind Nginx, Caddy, Traefik, or any reverse proxy.

Example config: [`nginx/example.conf`](nginx/example.conf)

Requirements when proxying:
- Forward `/ws` with WebSocket upgrade headers
- Set `X-Real-IP` and `X-Forwarded-For`
- TLS termination is the proxy's responsibility

---

## Security Model

- HTTP-only session cookie with `SameSite=Strict`
- CSRF double-submit cookie protection
- Login rate limiting
- Passwords hashed with Argon2id
- API key hashes stored server-side (plaintext shown once)
- Notification secrets stored in SQLite and only exposed through masked settings endpoints
- Cookie `Secure` flag auto-detects HTTPS (`COOKIE_SECURE=auto`)

> **Note:** Mounting `/var/run/docker.sock` grants privileged host access. The first-run wizard is locked after initial setup.

---

## Development

```bash
npm ci
npm run dev        # Express (tsx watch) + Vite dev server
```

Production build:

```bash
npm run build
npm start
```

---

## Architecture

```
piguard/
├── client/src/           # Lit Web Components frontend
│   ├── components/       # UI panels (dashboard, docker, network, ...)
│   ├── lib/              # API client, utilities
│   └── state/            # Store, WebSocket client, data sync
├── server/src/           # Express + TypeScript backend
│   ├── collectors/       # System, Docker, Nginx, network, security
│   ├── database/         # SQLite schema and repositories
│   ├── middleware/        # Auth, CSRF, rate limiting, security headers
│   ├── routes/           # REST API endpoints
│   └── services/         # Auth, alerts, health checks, notifications, AI
├── nginx/                # Example reverse proxy config
├── Dockerfile            # Multi-stage Docker build
└── docker-compose.yml    # Production compose file
```

---

## License

[MIT](LICENSE)
