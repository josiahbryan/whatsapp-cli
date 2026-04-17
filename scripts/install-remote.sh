#!/usr/bin/env bash
# One-liner installer for whatsapp-cli.
# Downloads the latest pre-compiled binary from GitHub Releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash

set -euo pipefail

REPO="josiahbryan/whatsapp-cli"
INSTALL_DIR="/usr/local/bin"
INSTALL_PATH="$INSTALL_DIR/whatsapp-cli"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)
    echo "[install] Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)
    echo "[install] Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

BINARY_NAME="whatsapp-cli-${PLATFORM}-${ARCH}"
echo "[install] Detected platform: ${PLATFORM}-${ARCH}"

echo "[install] Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | head -1 | sed 's/.*: *"//;s/".*//')

if [ -z "$TAG" ]; then
  echo "[install] Error: could not determine latest release."
  echo "[install] Check https://github.com/${REPO}/releases"
  exit 1
fi

echo "[install] Latest release: $TAG"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}"
echo "[install] Downloading ${BINARY_NAME}..."

TMPFILE=$(mktemp)
HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null || true)

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
  rm -f "$TMPFILE"
  echo "[install] Error: download failed (HTTP $HTTP_CODE)"
  echo "[install] URL: $DOWNLOAD_URL"
  exit 1
fi

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "$INSTALL_PATH"
  chmod 755 "$INSTALL_PATH"
else
  echo "[install] $INSTALL_DIR not writable, using sudo..."
  sudo mv "$TMPFILE" "$INSTALL_PATH"
  sudo chmod 755 "$INSTALL_PATH"
fi

# Bun 1.3's --compile embeds an invalid ad-hoc signature; macOS AMFI
# SIGKILLs binaries that fail codesign verification. Re-sign ad-hoc so
# the binary can exec. GitHub's download path also strips xattrs that
# would have marked it quarantined.
if [ "$PLATFORM" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
  if [ -w "$INSTALL_PATH" ]; then
    codesign --sign - --force "$INSTALL_PATH"
  else
    sudo codesign --sign - --force "$INSTALL_PATH"
  fi
fi

echo "[install] Installed whatsapp-cli to $INSTALL_PATH"

VERSION=$("$INSTALL_PATH" --version 2>/dev/null || true)
if [ -n "$VERSION" ]; then
  echo "[install] Version: $VERSION"
  echo "[install] Done! Run 'whatsapp-cli pair' to get started."
else
  echo "[install] Warning: verification failed. Check that $INSTALL_DIR is in your PATH."
fi
