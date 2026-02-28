#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

docker compose up -d --build
docker compose run --rm --entrypoint="" logto \
  node /etc/logto/packages/cli/bin/logto.js database alteration deploy next || true

docker compose ps
