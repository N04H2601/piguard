# PiGuard

Self-hosted monitoring dashboard for Raspberry Pi and small Linux hosts.

`PiGuard` gives you a clean web UI for host metrics, Docker visibility, service health checks, security posture, alerts, reverse-proxy activity, and an optional AI assistant for operational triage.

![Dashboard overview](docs/dashboard-overview.png)

## Why This Exists

Most Raspberry Pi monitoring stacks are either too heavy, too generic, or too annoying to bootstrap.

This project is built around a simpler path:

- start one container
- open the UI
- complete a first-run wizard
- monitor the machine immediately

No manual database setup. No application config file to hand-edit. No need to define admin credentials, checks, or notifications in `.env`.

## Features

- Real-time system overview: CPU, memory, temperature, uptime, disks, processes, network rates
- Docker monitoring: container status, CPU/RAM usage, logs
- Health checks: HTTP, TCP, DNS, ICMP, uptime history, per-check intervals
- Security panel: SSH posture, firewall visibility, fail2ban, WireGuard, SSL presence
- Alerts engine: threshold-based rules with notification channels
- Reverse proxy visibility: Nginx access/error parsing, top URIs, vhosts, WebSocket count
- Optional AI assistant: short operational analysis, guided prompts, persistent conversations
- First-run wizard: admin account, language, health checks, notifications
- Lightweight stack: Express, Lit Web Components, SQLite, WebSocket

## Stack

- Backend: Express + TypeScript + SQLite + WebSocket
- Frontend: Lit Web Components + Vite
- Runtime: Docker / Docker Compose
- Database: SQLite

## Quick Start

Three commands on a fresh machine:

```bash
git clone https://github.com/N04H2601/piguard.git && cd piguard
cp .env.example .env
docker compose up -d --build
```

Then open `http://<your-pi-ip>:3333` and complete the first-run wizard.

## First-Run Wizard

On a fresh install, the dashboard opens directly into a browser setup flow.

The wizard asks for:

- admin username and password
- default language (`fr` or `en`)
- initial health checks
- notification settings
  - `ntfy`
  - Telegram
  - generic webhook

When setup completes, the dashboard:

- stores the configuration in SQLite
- creates the admin account
- seeds the initial health checks
- signs the user in automatically

## Runtime Configuration

The `.env` file is intentionally small. It is meant for container/runtime values such as:

- `PORT`
- `TZ`
- `NODE_ENV`
- optional `OPENAI_API_KEY`
- optional `OPENAI_MODEL`

Application-level settings are configured from the web UI, not from `.env`.

## Docker Compose Notes

The default `docker-compose.yml` is tuned for Raspberry Pi and Linux host monitoring.

It mounts:

- `/proc`
- `/sys`
- `/` as `/host/root`
- `/var/run/docker.sock`

That gives the dashboard enough visibility to inspect host metrics and Docker state without hardcoding a personal filesystem layout.

## Optional AI Assistant

The AI assistant is optional. If no OpenAI key is configured, the rest of the dashboard works normally.

To enable it:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
```

## Security Model

Current protections include:

- HTTP-only session cookie
- CSRF protection for browser mutations
- login rate limiting
- server-side API key usage for the assistant
- no client-side storage of admin passwords
- first-run configuration persisted server-side in SQLite

Operational notes:

- TLS termination remains the responsibility of the reverse proxy if you expose the dashboard publicly
- notification secrets are stored server-side in SQLite
- mounting `/var/run/docker.sock` should be treated as privileged host access

## Reverse Proxy

The dashboard can run directly on port `3333` or behind Nginx, Caddy, Traefik, or another reverse proxy.

If you proxy WebSockets, forward `/ws` with upgrade headers enabled.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Status

The current priority is straightforward installation and useful monitoring on small self-hosted machines. Broader polish can iterate later without changing the deployment model.

## License

Pick a license before publishing the repository.
