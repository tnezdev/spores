#!/usr/bin/env bash
# Pre-publish smoke test for @tnezdev/spores
#
# Validates that the npm-packed tarball is consumable by Bun:
#   1. npm pack → tarball
#   2. Install tarball in a temp directory
#   3. Import the public API under Bun and verify exports
#
# Usage: bash scripts/smoke-test.sh
# Requires: bun, npm

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo "==> Packing tarball..."
TARBALL=$(cd "$REPO_ROOT" && npm pack --pack-destination "$TMPDIR_BASE" 2>/dev/null)
TARBALL_PATH="$TMPDIR_BASE/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "FAIL: npm pack did not produce a tarball"
  exit 1
fi
echo "    Tarball: $TARBALL"

echo "==> Setting up consumer project..."
CONSUMER="$TMPDIR_BASE/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<'PKG'
{ "name": "smoke-consumer", "version": "0.0.0", "type": "module" }
PKG

echo "==> Installing from tarball..."
(cd "$CONSUMER" && bun add "$TARBALL_PATH" 2>&1)

echo "==> Running consumer script under Bun..."
bun run "$REPO_ROOT/scripts/smoke-consumer.ts" "$CONSUMER"

echo ""
echo "==> Smoke test passed."
