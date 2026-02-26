#!/usr/bin/env bash
set -euo pipefail

echo "[nicematrix-id] basic checks"
docker compose config >/dev/null
echo "OK"
