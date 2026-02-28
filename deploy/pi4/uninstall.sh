#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/notnextcloud2}"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./uninstall.sh

Stops and removes the NotNextCloud2 container via docker compose.
Does not delete application files or data.

Environment variables:
  APP_DIR   Install directory containing docker-compose.yml (default: /opt/notnextcloud2)
EOF
  exit 0
fi

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This script needs root privileges (sudo not found)." >&2
    exit 1
  fi
}

if [[ ! -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "No install found at $APP_DIR (docker-compose.yml missing)."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Nothing to stop."
  exit 0
fi

echo "Stopping and removing container(s)..."
run_as_root docker compose -f "$APP_DIR/docker-compose.yml" down --remove-orphans
echo "Uninstall complete."
