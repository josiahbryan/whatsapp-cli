#!/usr/bin/env bash
# Cross-compile and create a GitHub Release with binaries for all platforms.
#
# Usage: bash scripts/release.sh v0.1.0

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "  e.g. bash scripts/release.sh v0.1.0"
  exit 1
fi

if ! echo "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must match vX.Y.Z (e.g. v0.1.0)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
SRC="$PROJECT_DIR/src/cli.ts"

echo "=== Building whatsapp-cli $VERSION ==="

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

TARGETS=(
  "bun-darwin-arm64:whatsapp-cli-darwin-arm64"
  "bun-darwin-x64:whatsapp-cli-darwin-x64"
  "bun-linux-x64:whatsapp-cli-linux-x64"
  "bun-linux-arm64:whatsapp-cli-linux-arm64"
)

VERSION_NUM="${VERSION#v}"

for entry in "${TARGETS[@]}"; do
  TARGET="${entry%%:*}"
  OUTPUT="${entry##*:}"
  echo "  Building $OUTPUT ($TARGET)..."
  bun build \
    --compile \
    --target="$TARGET" \
    --define "WA_CLI_VERSION=\"$VERSION_NUM\"" \
    --outfile "$DIST_DIR/$OUTPUT" \
    "$SRC"
done

echo ""
echo "=== Binaries ==="
ls -lh "$DIST_DIR"/

echo ""
echo "=== Creating GitHub Release ==="

git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

gh release create "$VERSION" \
  "$DIST_DIR"/whatsapp-cli-* \
  --title "whatsapp-cli $VERSION" \
  --notes "$(cat <<EOF
## Install

### One-liner (recommended)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash
\`\`\`

### Direct download

| Platform | Binary |
|---|---|
| macOS Apple Silicon | whatsapp-cli-darwin-arm64 |
| macOS Intel | whatsapp-cli-darwin-x64 |
| Linux x86_64 | whatsapp-cli-linux-x64 |
| Linux ARM64 | whatsapp-cli-linux-arm64 |

## First-run setup

Puppeteer will download Chromium (~170MB) to \`~/.cache/puppeteer\` on first daemon start. Internet required.

\`\`\`bash
whatsapp-cli pair           # scan QR once
whatsapp-cli chats --limit 5 --json
\`\`\`

See [README](https://github.com/josiahbryan/whatsapp-cli#readme) for usage.
EOF
)"

echo ""
echo "=== Done! ==="
echo "Release: https://github.com/josiahbryan/whatsapp-cli/releases/tag/$VERSION"
