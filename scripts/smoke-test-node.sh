#!/usr/bin/env bash
# Node smoke test for @tnezdev/spores
#
# Validates that the npm-packed tarball is consumable by Node.js (the
# Bun-only constraint we lifted in #32). Mirrors smoke-test.sh but runs
# the consumer under Node instead of Bun.
#
#   1. npm pack → tarball (prepack runs `bun run build` → dist/)
#   2. Install tarball in a temp directory under npm
#   3. Run the plain-JS consumer script with Node
#
# Usage: bash scripts/smoke-test-node.sh
# Requires: bun (for build), npm, node
#
# This complements smoke-test.sh — both must pass before we ship.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo "==> Packing tarball (runs prepack → bun run build)..."
TARBALL=$(cd "$REPO_ROOT" && npm pack --silent --pack-destination "$TMPDIR_BASE" 2>/dev/null)
TARBALL_PATH="$TMPDIR_BASE/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "FAIL: npm pack did not produce a tarball"
  exit 1
fi
echo "    Tarball: $TARBALL"

echo "==> Setting up Node consumer project..."
CONSUMER="$TMPDIR_BASE/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<'PKG'
{ "name": "smoke-consumer-node", "version": "0.0.0", "type": "module" }
PKG

echo "==> Installing from tarball under npm..."
(cd "$CONSUMER" && npm install --silent "$TARBALL_PATH" 2>&1)

echo "==> Running consumer script under Node..."
node "$REPO_ROOT/scripts/smoke-consumer.mjs" "$CONSUMER"

echo ""
echo "==> Node smoke test passed."
