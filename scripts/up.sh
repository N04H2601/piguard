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

HOST_INTEGRATIONS="${PIGUARD_HOST_INTEGRATIONS:-$(read_env PIGUARD_HOST_INTEGRATIONS)}"
COMPOSE_ARGS=(-f "$ROOT_DIR/docker-compose.yml")

if [[ "${HOST_INTEGRATIONS:-0}" == "1" ]]; then
  COMPOSE_ARGS+=(-f "$ROOT_DIR/docker-compose.host-integrations.yml")
fi

"$ROOT_DIR/scripts/preflight.sh"
cd "$ROOT_DIR"
exec docker compose "${COMPOSE_ARGS[@]}" up -d --build "$@"
