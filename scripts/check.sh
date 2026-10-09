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

echo "[nicematrix-id] dev-features flag: frontend bundles (builder) and core runtime (app) share one value"
df=logto-custom/Dockerfile
stages=$(grep -cE '^FROM ' "$df")
envs=$(grep -cE '^ENV DEV_FEATURES_ENABLED=\$\{dev_features_enabled\}$' "$df")
global_arg=$(awk '/^FROM /{exit} /^ARG dev_features_enabled=/{n++} END{print n+0}' "$df")
if [ "$global_arg" != 1 ] || [ "$stages" != "$envs" ]; then
  echo "FAIL: $df needs one global 'ARG dev_features_enabled=...' and 'ENV DEV_FEATURES_ENABLED=\${dev_features_enabled}' in every stage (stages=$stages env=$envs global_arg=$global_arg)"; exit 1
fi
if grep -qE '^\s+DEV_FEATURES_ENABLED:' deploy/docker-compose.yml; then
  echo "FAIL: deploy/docker-compose.yml must not set runtime DEV_FEATURES_ENABLED (it would diverge from the baked bundles; use the build arg)"; exit 1
fi
echo "OK"
