#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/notnextcloud2}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./install.sh

Environment variables:
  APP_DIR   Target install directory (default: /opt/notnextcloud2)
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

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi
  require_cmd curl
  echo "Docker not found. Installing Docker Engine..."
  local tmp_script
  tmp_script="$(mktemp)"
  curl -fsSL https://get.docker.com -o "$tmp_script"
  run_as_root sh "$tmp_script"
  rm -f "$tmp_script"
}

ensure_compose_plugin() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker Compose plugin is missing and apt-get is unavailable." >&2
    echo "Install docker-compose-plugin, then re-run this script." >&2
    exit 1
  fi
  echo "Installing Docker Compose plugin..."
  run_as_root apt-get update
  run_as_root apt-get install -y docker-compose-plugin
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin install failed." >&2
    exit 1
  fi
}

ensure_docker_service() {
  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable docker
    run_as_root systemctl start docker
  fi
}

sync_bundle() {
  echo "Installing bundle into $APP_DIR ..."
  run_as_root mkdir -p "$APP_DIR"
  if command -v rsync >/dev/null 2>&1; then
    run_as_root rsync -a --delete \
      --exclude 'data/' \
      --exclude 'config.json' \
      --exclude '.env' \
      "$SCRIPT_DIR/" "$APP_DIR/"
  else
    tar -C "$SCRIPT_DIR" -cf - . | run_as_root tar -C "$APP_DIR" -xf -
  fi
  run_as_root mkdir -p "$APP_DIR/data"
}

ensure_config_file() {
  if [[ -f "$APP_DIR/config.json" ]]; then
    return
  fi
  if [[ ! -f "$APP_DIR/config.example.json" ]]; then
    echo "Missing config.example.json in bundle." >&2
    exit 1
  fi
  run_as_root cp "$APP_DIR/config.example.json" "$APP_DIR/config.json"
  echo "Created $APP_DIR/config.json from config.example.json"
  echo "Update credentials and roots before exposing the service."
}

start_container() {
  echo "Building and starting container..."
  run_as_root docker compose -f "$APP_DIR/docker-compose.yml" up -d --build
  run_as_root docker compose -f "$APP_DIR/docker-compose.yml" ps
}

main() {
  ensure_docker
  ensure_compose_plugin
  ensure_docker_service
  sync_bundle
  ensure_config_file
  start_container
  echo "Install complete."
  echo "URL: http://<your-pi-ip>:4170"
}

main "$@"
