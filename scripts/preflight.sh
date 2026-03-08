#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

read_env() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
  fi
}

check_port() {
  local port="$1"
  local label="$2"

  if [[ -z "$port" ]]; then
    return 0
  fi

  if ss -H -ltn "sport = :$port" | grep -q .; then
    echo "Port $port is already in use ($label). Change the matching value in .env before starting PiGuard." >&2
    exit 1
  fi
}

APP_PORT="$(read_env PORT)"

check_port "${APP_PORT:-3333}" "PiGuard HTTP"

echo "Preflight OK: required ports are available."
