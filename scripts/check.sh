#!/usr/bin/env bash
set -euo pipefail

echo "[nicematrix-id] basic checks"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config >/dev/null
echo "OK"
