#!/usr/bin/env bash
# Ad-hoc re-sign a bun --compile binary on macOS.
#
# Bun 1.3's --compile writes an ad-hoc signature whose embedded hash does
# not match the final file, so macOS AMFI SIGKILLs it at exec. Re-signing
# ad-hoc fixes the hash. No-op on non-Darwin hosts.
set -euo pipefail

BINARY="${1:-}"
if [ -z "$BINARY" ]; then
  echo "usage: postbuild-codesign.sh <binary>" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if ! command -v codesign >/dev/null 2>&1; then
  exit 0
fi

codesign --sign - --force "$BINARY"
