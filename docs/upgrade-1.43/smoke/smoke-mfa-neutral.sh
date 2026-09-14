#!/usr/bin/env bash
# Stage 4 smoke item 9: MFA behaviour neutrality (PLAN §5).
# Binding a TOTP factor through the Account API must NOT flip logtoConfig.mfa.enabled.
# Also smoke item 7: Management API by-identity + verification-records/assert.
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
APP_ID=luckh1qjgg76zidyaipk6
PW='Smoke-1.43-Neutral!x9'

pass=0; fail=0
ok(){ echo "  ok   - $1"; pass=$((pass+1)); }
no(){ echo "  FAIL - $1"; echo "         $2"; fail=$((fail+1)); }
jqr(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }
psqlq(){ docker exec nicematrix-id-postgres psql -U logto -d logto -At -c "$1"; }

M2M=$(curl -sS -X POST "$ID/oidc/token" -u "$M2M_ID:$M2M_SECRET" \
  -d grant_type=client_credentials -d "resource=$MGMT_RES" -d scope=all | jqr access_token)
[ -n "$M2M" ] || { echo "no m2m token"; exit 1; }
MAPI(){ curl -sS -H "Authorization: Bearer $M2M" -H 'Content-Type: application/json' "$@"; }

echo "== item 7: Management API custom routes =="
U=$(MAPI "$ID/api/users?page_size=1" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
C=$(MAPI -o /dev/null -w '%{http_code}' "$ID/api/users/by-identity?target=wechat&userId=__no_such_openid__")
[ "$C" = "404" ] && ok "by-identity miss -> 404" || no "by-identity miss" "got $C"
C=$(MAPI -o /dev/null -w '%{http_code}' "$ID/api/users/by-identity?target=evil&userId=x")
[ "$C" = "400" ] && ok "by-identity unknown target -> 400 (allowlist holds)" || no "by-identity allowlist" "got $C"
C=$(MAPI -o /dev/null -w '%{http_code}' -X POST "$ID/api/users/$U/verification-records/assert" -d '{"recordId":"nonexistent"}')
[ "$C" = "422" ] && ok "verification-records/assert bogus id -> 422" || no "assert bogus" "got $C"
C=$(MAPI -o /dev/null -w '%{http_code}' -X POST "$ID/api/users/$U/verification-records/assert" -d '{}')
[ "$C" = "400" ] && ok "verification-records/assert missing body -> 400" || no "assert guard" "got $C"

echo
echo "== item 9: MFA neutrality (§5) =="
UNAME="smoke143mfa$RANDOM"
NEW=$(MAPI -X POST "$ID/api/users" -d "{\"username\":\"$UNAME\",\"password\":\"$PW\"}")
NU=$(echo "$NEW" | jqr id)
[ -n "$NU" ] && echo "  test user: $NU ($UNAME)" || { echo "  could not create user: $NEW"; exit 1; }
cleanup(){ MAPI -o /dev/null -X DELETE "$ID/api/users/$NU" >/dev/null 2>&1; echo "  (test user $NU deleted)"; }
trap cleanup EXIT

BEFORE=$(psqlq "select coalesce(logto_config::text,'{}') from users where id='$NU';")
echo "  logto_config BEFORE = $BEFORE"

# account token via token-exchange (same path the backend uses)
ST=$(MAPI -X POST "$ID/api/subject-tokens" -d "{\"userId\":\"$NU\"}" | jqr subjectToken)
AT=$(curl -sS -X POST "$ID/oidc/token" \
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d "subject_token=$ST" -d subject_token_type=urn:logto:token-type:impersonation_token \
  -d "client_id=$APP_ID" -d 'scope=openid identities' | jqr access_token)
[ -n "$AT" ] && ok "account token minted (scope=openid identities)" || no "account token" "empty"

VR=$(curl -sS -X POST "$ID/api/verifications/password" \
  -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}")
VID=$(echo "$VR" | jqr verificationRecordId)
[ -n "$VID" ] && ok "password verification record created" || no "verification record" "$VR"

SECRET=$(python3 - <<'PY'
import base64, secrets
print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip('='))
PY
)
BIND=$(curl -sS -o /tmp/bind.out -w '%{http_code}' -X POST "$ID/api/my-account/mfa-verifications" \
  -H "Authorization: Bearer $AT" -H "logto-verification-id: $VID" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"Totp\",\"secret\":\"$SECRET\"}")
echo "  bind TOTP -> HTTP $BIND $(cat /tmp/bind.out)"
[ "$BIND" = "204" ] && ok "TOTP bound via Account API" || no "TOTP bind" "HTTP $BIND $(cat /tmp/bind.out)"

HAS_TOTP=$(psqlq "select mfa_verifications::text like '%Totp%' from users where id='$NU';")
AFTER=$(psqlq "select coalesce(logto_config::text,'{}') from users where id='$NU';")
echo "  mfa_verifications has Totp = $HAS_TOTP"
echo "  logto_config AFTER  = $AFTER"

[ "$HAS_TOTP" = "t" ] && ok "factor really persisted (mfa_verifications written)" || no "factor persisted" "$HAS_TOTP"
[ "$AFTER" = "$BEFORE" ] && ok "logto_config UNCHANGED -> mfa.enabled not auto-set (§5 neutral)" \
  || no "MFA NEUTRALITY BROKEN" "before=$BEFORE after=$AFTER"
echo "$AFTER" | grep -q '"enabled": *true' && no "mfa.enabled=true leaked" "$AFTER" || ok "no mfa.enabled=true anywhere in logto_config"

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
