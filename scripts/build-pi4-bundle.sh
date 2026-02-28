#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BUNDLE_NAME="notnextcloud2-pi4"
BUNDLE_DIR="$DIST_DIR/$BUNDLE_NAME"
ARCHIVE_PATH="$DIST_DIR/$BUNDLE_NAME.tar.gz"

echo "Building Pi 4 bundle in $BUNDLE_DIR"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/clients"

cp "$ROOT_DIR/Dockerfile" "$BUNDLE_DIR/"
cp "$ROOT_DIR/.dockerignore" "$BUNDLE_DIR/"
if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude '.DS_Store' \
    "$ROOT_DIR/server/" "$BUNDLE_DIR/server/"
  rsync -a \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude '.DS_Store' \
    "$ROOT_DIR/clients/web/" "$BUNDLE_DIR/clients/web/"
else
  cp -R "$ROOT_DIR/server" "$BUNDLE_DIR/server"
  cp -R "$ROOT_DIR/clients/web" "$BUNDLE_DIR/clients/web"
fi

cp "$ROOT_DIR/deploy/pi4/docker-compose.yml" "$BUNDLE_DIR/docker-compose.yml"
cp "$ROOT_DIR/deploy/pi4/config.example.json" "$BUNDLE_DIR/config.example.json"
cp "$ROOT_DIR/deploy/pi4/install.sh" "$BUNDLE_DIR/install.sh"
cp "$ROOT_DIR/deploy/pi4/uninstall.sh" "$BUNDLE_DIR/uninstall.sh"
cp "$ROOT_DIR/deploy/pi4/README.md" "$BUNDLE_DIR/README.md"

chmod +x "$BUNDLE_DIR/install.sh" "$BUNDLE_DIR/uninstall.sh"

mkdir -p "$DIST_DIR"
tar -C "$DIST_DIR" -czf "$ARCHIVE_PATH" "$BUNDLE_NAME"

echo "Bundle ready:"
echo "  Folder:  $BUNDLE_DIR"
echo "  Archive: $ARCHIVE_PATH"
