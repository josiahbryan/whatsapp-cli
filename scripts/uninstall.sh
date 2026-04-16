#!/usr/bin/env bash
set -euo pipefail
INSTALL_PATH="/usr/local/bin/whatsapp-cli"
if [ -e "$INSTALL_PATH" ]; then
  if [ -w "$INSTALL_PATH" ]; then rm -f "$INSTALL_PATH"; else sudo rm -f "$INSTALL_PATH"; fi
  echo "[uninstall] Removed $INSTALL_PATH"
else
  echo "[uninstall] Not installed at $INSTALL_PATH"
fi
