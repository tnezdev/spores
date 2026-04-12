#!/usr/bin/env bash
# Post-publish validation for @tnezdev/spores
#
# Installs the package from the npm registry (not a local tarball) and
# verifies it loads under Bun. Use this after a release to confirm the
# published package works end-to-end from a consumer's perspective.
#
# Usage: bash scripts/post-publish-check.sh [version]
#   version  Optional — defaults to "latest". Pass e.g. "0.2.0" to check
#            a specific version. Useful right after publish when "latest"
#            may not have propagated yet.
#
# Requires: bun

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-latest}"
PKG="@tnezdev/spores@${VERSION}"

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

CONSUMER="$TMPDIR_BASE/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<'PKG_JSON'
{ "name": "post-publish-consumer", "version": "0.0.0", "type": "module" }
PKG_JSON

echo "==> Installing ${PKG} from registry..."
(cd "$CONSUMER" && bun add "$PKG" 2>&1)

INSTALLED=$(cd "$CONSUMER" && bun -e "const p = require('./node_modules/@tnezdev/spores/package.json'); console.log(p.version)")
echo "    Installed version: ${INSTALLED}"

echo "==> Running consumer script under Bun..."
bun run "$REPO_ROOT/scripts/smoke-consumer.ts" "$CONSUMER"

echo ""
echo "==> Post-publish check passed (${PKG})."
