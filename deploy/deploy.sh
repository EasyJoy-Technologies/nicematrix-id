#!/usr/bin/env bash
set -euo pipefail

# Safe image switcher only. It never builds an image and never runs a database
# alteration. Build/transfer and schema changes remain explicit, separately
# reviewed operations.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/deploy/docker-compose.yml"
ENV_FILE="${ID_ENV_FILE:-/etc/nicematrix/id.env}"
PROJECT="nicematrix-id"
TARGET=""
CANDIDATE=""
APPLY=0
BACKUP_KEEP="${BACKUP_KEEP:-3}"
case "$BACKUP_KEEP" in
  ''|*[!0-9]*) echo "[deploy] BACKUP_KEEP must be an integer >= 2" >&2; exit 2;;
esac
[ "$BACKUP_KEEP" -ge 2 ] || {
  echo "[deploy] BACKUP_KEEP must be an integer >= 2" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2;;
    --candidate) CANDIDATE="${2:-}"; shift 2;;
    --apply) APPLY=1; shift;;
    -h|--help) echo "usage: $0 --target <staging|prod-1> --candidate IMAGE:TAG --apply"; exit 0;;
    *) echo "[id-deploy] unknown argument: $1" >&2; exit 2;;
  esac
done

case "$TARGET" in
  staging) EXPECTED_STAMP="staging-build-host"; ENDPOINT="https://id-staging.nicematrix.com";;
  prod-1) EXPECTED_STAMP="prod-1-intl"; ENDPOINT="https://id.nicematrix.com";;
  *) echo "[id-deploy] --target must be staging or prod-1" >&2; exit 2;;
esac
[ -n "$CANDIDATE" ] || { echo "[id-deploy] --candidate is required" >&2; exit 2; }
if [[ ! "$CANDIDATE" =~ ^nicematrix-logto:release-[0-9a-f]{7,40}-[0-9]{8}-[0-9]{6}$ ]] &&
   [[ ! "$CANDIDATE" =~ ^nicematrix-logto:rollback-${TARGET}-[0-9]{8}-[0-9]{6}$ ]]; then
  echo "[id-deploy] candidate must be a release tag or a rollback tag for target=$TARGET" >&2
  exit 2
fi
[ -f "$COMPOSE" ] && [ -f "$ENV_FILE" ] || { echo "[id-deploy] compose/env file missing" >&2; exit 1; }

STAMP_FILE="${DEPLOY_TARGET_FILE:-/etc/nicematrix/deploy-target}"
[ -f "$STAMP_FILE" ] || { echo "[id-deploy] host stamp missing" >&2; exit 3; }
[ "$(tr -d '[:space:]' < "$STAMP_FILE")" = "$EXPECTED_STAMP" ] || {
  echo "[id-deploy] wrong host for target $TARGET" >&2; exit 3;
}
docker image inspect "$CANDIDATE" >/dev/null

if [ "$TARGET" = "prod-1" ]; then
  RECEIPT="${LOGTO_BACKUP_RECEIPT:-/run/nicematrix-backup/logto-latest.ok}"
  [ -f "$RECEIPT" ] || { echo "[id-deploy] fresh Logto R2 backup receipt missing: $RECEIPT" >&2; exit 4; }
  node - "$RECEIPT" <<'NODE' || exit 4
const fs = require('fs');
const receiptPath = process.argv[2];
try {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const completed = Date.parse(receipt.completed_at);
  const age = Date.now() - completed;
  if (!Number.isFinite(completed) || age < -5 * 60 * 1000 || age > 30 * 60 * 60 * 1000 ||
      typeof receipt.set !== 'string' || receipt.set.length < 10 ||
      !Number.isInteger(receipt.files) || receipt.files < 1 ||
      !Number.isFinite(receipt.bytes) || receipt.bytes < 1 ||
      !Number.isInteger(receipt.base_sets_kept) || receipt.base_sets_kept < 2) {
    throw new Error('missing fields, invalid timestamp, or insufficient verified base sets');
  }
} catch (error) {
  console.error(`[id-deploy] invalid or stale Logto R2 receipt: ${error.message}`);
  process.exit(1);
}
NODE
fi

if [ "$APPLY" -ne 1 ]; then
  echo "[id-deploy] preflight OK target=$TARGET candidate=$CANDIDATE; add --apply to switch"
  exit 0
fi

mkdir -p /run/lock
exec 9>/run/lock/nicematrix-id-deploy.lock
flock -n 9 || { echo "[id-deploy] another ID deployment is active" >&2; exit 5; }

CURRENT_IMAGE_ID="$(docker inspect -f '{{.Image}}' nicematrix-logto)"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_TAG="nicematrix-logto:rollback-${TARGET}-${TIMESTAMP}"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SWITCHED=0

compose_up() {
  docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$COMPOSE" \
    up -d --no-build --no-deps --force-recreate logto
}

wait_healthy() {
  local i status
  for i in $(seq 1 24); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' nicematrix-logto 2>/dev/null || true)"
    [ "$status" = "healthy" ] && return 0
    sleep 5
  done
  echo "[id-deploy] container did not become healthy" >&2
  return 1
}

rollback() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" -eq 1 ]; then
    echo "[id-deploy] verification failed; restoring $BACKUP_TAG" >&2
    docker tag "$BACKUP_TAG" nicematrix-logto:latest
    compose_up || true
    wait_healthy || echo "[id-deploy] CRITICAL: rollback did not become healthy" >&2
  fi
  exit "$rc"
}
trap rollback EXIT

docker tag "$CURRENT_IMAGE_ID" "$BACKUP_TAG"
docker tag "$CANDIDATE" nicematrix-logto:latest
SWITCHED=1
compose_up
wait_healthy

curl -fsS "$ENDPOINT/oidc/.well-known/openid-configuration" -o /dev/null -m 15
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$ENDPOINT/api/status" -m 15)" = "204" ]
curl -fsS "$ENDPOINT/oidc/jwks" -o /dev/null -m 15
if docker logs --since "$START_ISO" nicematrix-logto 2>&1 | grep -q 'server_error'; then
  echo "[id-deploy] server_error found after image switch" >&2
  exit 1
fi

SWITCHED=0
mapfile -t old_tags < <(docker images nicematrix-logto --format '{{.Tag}}' | \
  grep "^rollback-${TARGET}-" | sort -r | tail -n "+$((BACKUP_KEEP + 1))" || true)
for tag in "${old_tags[@]}"; do docker image rm "nicematrix-logto:$tag" >/dev/null || true; done
mapfile -t old_releases < <(docker images nicematrix-logto --format '{{.CreatedAt}}|{{.Tag}}' | \
  grep '|release-' | sort -r | tail -n "+$((BACKUP_KEEP + 1))" | cut -d'|' -f2 || true)
for tag in "${old_releases[@]}"; do docker image rm "nicematrix-logto:$tag" >/dev/null || true; done
echo "[id-deploy] complete target=$TARGET candidate=$CANDIDATE rollback=$BACKUP_TAG"
