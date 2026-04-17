#!/usr/bin/env bash
# Local install: copies the compiled binary from dist/ to /usr/local/bin.
# Run after `pnpm run build`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="$PROJECT_DIR/dist/whatsapp-cli"
INSTALL_DIR="/usr/local/bin"
INSTALL_PATH="$INSTALL_DIR/whatsapp-cli"

if [ ! -x "$BINARY" ]; then
  echo "[install] $BINARY not found. Run 'pnpm run build' first."
  exit 1
fi

if [ -w "$INSTALL_DIR" ]; then
  cp "$BINARY" "$INSTALL_PATH"
  chmod 755 "$INSTALL_PATH"
else
  echo "[install] $INSTALL_DIR not writable, using sudo..."
  sudo cp "$BINARY" "$INSTALL_PATH"
  sudo chmod 755 "$INSTALL_PATH"
fi

# Bun 1.3's --compile embeds an invalid ad-hoc signature (hash mismatch),
# and macOS AMFI SIGKILLs any binary whose codesign check fails. Re-sign
# ad-hoc on install so the binary can actually exec.
if [ "$(uname -s)" = "Darwin" ] && command -v codesign >/dev/null 2>&1; then
  if [ -w "$INSTALL_PATH" ]; then
    codesign --sign - --force "$INSTALL_PATH"
  else
    sudo codesign --sign - --force "$INSTALL_PATH"
  fi
fi

echo "[install] Installed whatsapp-cli to $INSTALL_PATH"
"$INSTALL_PATH" --version
