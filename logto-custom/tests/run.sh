#!/usr/bin/env bash
# Run NiceMatrix-ID override unit tests.
# These are intentionally standalone (no Logto / pnpm install required) — we
# tsc-compile each .ts override individually and exercise the public API.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSC="${TSC:-/root/projects/nicematrix-backend/apps/admin-web/node_modules/.bin/tsc}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if [[ ! -x "$TSC" ]]; then
  echo "[error] tsc not found at $TSC; set TSC=... to override" >&2
  exit 2
fi

echo "[1/3] Compiling native-caps.ts via tsc..."
cp "$ROOT/overrides/packages/experience/src/utils/native-caps.ts" "$TMPDIR/native-caps.ts"
"$TSC" --target es2020 --module commonjs --moduleResolution node \
  --strict false --skipLibCheck --outDir "$TMPDIR" "$TMPDIR/native-caps.ts"

echo "[2/3] Running native-caps.test.js..."
# Test file expects compiled JS at /tmp/native-caps.js for historical reasons —
# symlink (or copy) into place under our temp dir, then run.
cp "$TMPDIR/native-caps.js" /tmp/native-caps.js
node "$ROOT/tests/test-native-caps.js"

echo "[3/3] Compiling + running region-routing.test.js..."
cp "$ROOT/overrides/packages/core/src/libraries/hook/region-routing.ts" "$TMPDIR/region-routing.ts"
"$TSC" --target es2020 --module commonjs --moduleResolution node \
  --strict false --skipLibCheck --outDir "$TMPDIR" "$TMPDIR/region-routing.ts"
cp "$TMPDIR/region-routing.js" /tmp/region-routing.js
node "$ROOT/tests/test-region-routing.js"
