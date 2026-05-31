#!/usr/bin/env bash
#
# ensure-idtoken-custom-data-claim.sh
#
# Idempotently ensure the `custom_data` extended claim is enabled in the
# id_token for the NiceMatrix Logto **admin** tenant.
#
# WHY THIS EXISTS
# ---------------
# NiceMatrix materializes each migrated (legacy CN) user's original
# `t_user.user_identify` into Logto `users.custom_data.legacy_user_identify`.
# The cloud-sync (netdisk) feature needs the client to know that legacy id
# WITHOUT a dedicated lookup. By enabling `custom_data` as an id_token
# extended claim, every login / refresh id_token carries `custom_data`, so:
#   - migrated user  -> id_token.custom_data.legacy_user_identify present
#   - new user       -> id_token.custom_data == {} (no legacy key)
# Zero extra request; presence of the key is the legacy/new discriminator.
#
# IMPORTANT: this is RUNTIME TENANT CONFIG (a row in `logto_configs`,
# key='idToken'), NOT a source override. The default Logto seed only enables
# ['roles','organizations','organization_roles']. A fresh re-seed / DB reset
# WILL drop `custom_data` and silently break the netdisk legacy-id path.
# Re-run this script after any tenant re-seed.
#
# Mechanics verified against the running self-compiled image (1.40.1):
#   - PUT /api/configs/id-token routes through wellKnownCache.mutate ->
#     proper cache invalidation; effective immediately, NO container restart.
#   - prod-1 has no Redis for Logto, so the config is effectively read from
#     DB on every token issuance.
#   - Both the standard authorization_code path and the NiceMatrix
#     token-exchange override issue id_token via the same
#     account.claims('id_token', scope, ...) pipeline that reads this config,
#     so enabling it covers BOTH normal login and native social login.
#   - The claim is still scope-gated: only requests whose scope contains
#     `custom_data` receive it. access_token is unaffected.
#
# USAGE
#   M2M_ID=m-admin M2M_SECRET=*** \
#     ./scripts/ensure-idtoken-custom-data-claim.sh [--check]
#
#   --check : report only, exit 0 if already enabled, 3 if missing. No write.
#
# ENV
#   M2M_ID, M2M_SECRET   Logto admin-tenant M2M (resource = .../admin/api).
#   LOGTO_ENDPOINT       default https://id.nicematrix.com
#
set -euo pipefail

LOGTO_ENDPOINT="${LOGTO_ENDPOINT:-https://id.nicematrix.com}"
ISSUER="$LOGTO_ENDPOINT/oidc"
MGMT="$LOGTO_ENDPOINT/api"
RESOURCE_ADMIN="$LOGTO_ENDPOINT/admin/api"
TARGET_CLAIM="custom_data"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

: "${M2M_ID:?set M2M_ID}"; : "${M2M_SECRET:?set M2M_SECRET}"

m2m_token() {
  curl -fsS -X POST "$ISSUER/token" -u "$M2M_ID:$M2M_SECRET" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "resource=$RESOURCE_ADMIN" \
    --data-urlencode 'scope=all' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'
}

TOKEN="$(m2m_token)"
[ -n "$TOKEN" ] || { echo "FATAL: could not obtain M2M token"; exit 1; }

CUR="$(curl -fsS "$MGMT/configs/id-token" -H "Authorization: Bearer $TOKEN")"
echo "current: $CUR"

HAS="$(printf '%s' "$CUR" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("yes" if "'"$TARGET_CLAIM"'" in (d.get("enabledExtendedClaims") or []) else "no")')"

if [ "$HAS" = "yes" ]; then
  echo "OK: '$TARGET_CLAIM' already enabled in id_token extended claims."
  exit 0
fi

if [ "$CHECK_ONLY" = "1" ]; then
  echo "MISSING: '$TARGET_CLAIM' not enabled (run without --check to fix)."
  exit 3
fi

# Build the new array = current + custom_data (dedup, preserve order).
NEW="$(printf '%s' "$CUR" | python3 -c '
import sys,json
d=json.load(sys.stdin)
cur=d.get("enabledExtendedClaims") or []
if "'"$TARGET_CLAIM"'" not in cur: cur=cur+["'"$TARGET_CLAIM"'"]
print(json.dumps({"enabledExtendedClaims":cur}))')"

echo "applying: $NEW"
RES="$(curl -fsS -X PUT "$MGMT/configs/id-token" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$NEW")"
echo "result:  $RES"

OK="$(printf '%s' "$RES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("yes" if "'"$TARGET_CLAIM"'" in (d.get("enabledExtendedClaims") or []) else "no")')"
[ "$OK" = "yes" ] || { echo "FATAL: claim not present after PUT"; exit 1; }
echo "DONE: '$TARGET_CLAIM' enabled in id_token extended claims (admin tenant)."
