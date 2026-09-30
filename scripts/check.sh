#!/usr/bin/env bash
set -euo pipefail

echo "[nicematrix-id] basic checks"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config >/dev/null
echo "OK"

echo "[nicematrix-id] every CREATE TABLE in sql/ enables row-level security (Logto startup precondition)"
missing=0
for f in sql/*.sql; do
  case "$f" in *.down.sql) continue;; esac
  for t in $(grep -oiE "create table (if not exists )?[a-z_]+" "$f" | awk '{print $NF}'); do
    if ! grep -qiE "alter table( if exists)? ${t} enable row level security" "$f"; then
      echo "  missing RLS: $f -> $t"; missing=1
    fi
  done
done
[ "$missing" = 0 ] && echo "OK" || { echo "FAIL: Logto will not start with a public table lacking RLS"; exit 1; }
