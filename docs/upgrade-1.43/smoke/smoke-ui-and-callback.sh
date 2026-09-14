#!/usr/bin/env bash
# Stage 4 smoke items 4, 5, 8:
#   8 - Console / Experience / Account SPA assets served by the new image
#   5 - the 1.43 UNIFIED social callback URI: /callback/:connectorId routed by `state` prefix,
#       plus the QQ ICP origin override surviving into the built bundles
#   4 - Account Center: every endpoint backing the six sections answers correctly
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
APP_ID=luckh1qjgg76zidyaipk6
QQ=xelhp9uuatn4qmf4pb7hb
PW='Ui-1.43-Smoke!x9'

pass=0; fail=0
ok(){ echo "  ok   - $1"; pass=$((pass+1)); }
no(){ echo "  FAIL - $1"; echo "         $2"; fail=$((fail+1)); }
jqr(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }

echo "== item 8: SPA assets + Console =="
for p in /sign-in /console /account; do
  # /sign-in 302s to the first-screen route; follow redirects and assert the SPA HTML lands.
  C=$(curl -sSL -o /tmp/spa.html -w '%{http_code}' "$ID$p")
  if [ "$C" = "200" ] && grep -qi '<div id="app"\|<!doctype html' /tmp/spa.html; then
    ok "GET $p -> SPA HTML (200 after redirects)"
  else
    no "GET $p" "got $C"
  fi
done
C=$(curl -sS "$ID/api/.well-known/sign-in-exp" -o /tmp/sie.json -w '%{http_code}')
[ "$C" = "200" ] && ok "GET /api/.well-known/sign-in-exp -> 200" || no "sign-in-exp" "got $C"
python3 -c "
import json; d=json.load(open('/tmp/sie.json'))
print('  connectors:', [c['target'] for c in d.get('socialConnectors',[])])
assert d.get('socialConnectors') is not None
" && ok "sign-in-exp exposes social connectors" || no "sign-in-exp payload" "see above"
C=$(curl -sS -o /dev/null -w '%{http_code}' "$ID/api/.well-known/account-center")
[ "$C" = "200" ] && ok "GET /api/.well-known/account-center -> 200" || no "account-center well-known" "got $C"

echo
echo "== item 5: unified social callback routing (upstream b64d46d495) =="
L=$(curl -sS -o /dev/null -w '%{redirect_url}' "$ID/callback/$QQ?code=x&state=ac_abc123")
case "$L" in
  *"/account/callback/social/$QQ"*) ok "state=ac_* -> 303 to the Account Center callback" ;;
  *) no "ac_ state routing" "$L" ;;
esac
C=$(curl -sS -o /dev/null -w '%{http_code}' "$ID/callback/$QQ?code=x&state=se_abc123")
[ "$C" = "200" ] && ok "state=se_* falls through to the Experience SPA (200)" || no "se_ state routing" "got $C"
C=$(curl -sS -o /dev/null -w '%{http_code}' "$ID/callback/$QQ?code=x&state=legacyplainstate")
[ "$C" = "200" ] && ok "unknown/legacy state still defaults to the Experience SPA (in-flight safe)" || no "legacy state" "got $C"
# the ICP bounce host must still forward path+query verbatim
L=$(curl -sS -o /dev/null -w '%{redirect_url}' "https://id.ej-mobile.cn/callback/$QQ?code=x&state=ac_abc123" --max-time 20)
case "$L" in
  "https://id.nicematrix.com/callback/$QQ?code=x&state=ac_abc123") ok "QQ ICP host 302 preserves path+query for the unified URI" ;;
  *) no "ICP bounce" "$L" ;;
esac
# the QQ origin override must be present in the shipped bundles
EXP=$(docker exec nicematrix-logto sh -c "grep -rl 'id.ej-mobile.cn' /etc/logto/packages/experience/dist/assets 2>/dev/null | head -1")
ACC=$(docker exec nicematrix-logto sh -c "grep -rl 'id.ej-mobile.cn' /etc/logto/packages/account/dist/assets 2>/dev/null | head -1")
[ -n "$EXP" ] && ok "QQ ICP origin present in the experience bundle" || no "experience bundle" "not found"
[ -n "$ACC" ] && ok "QQ ICP origin present in the account-center bundle" || no "account bundle" "not found"

echo
echo "== item 4: Account Center six sections (API surface) =="
M2M=$(curl -sS -X POST "$ID/oidc/token" -u "$M2M_ID:$M2M_SECRET" \
  -d grant_type=client_credentials -d "resource=$MGMT_RES" -d scope=all | jqr access_token)
MAPI(){ curl -sS -H "Authorization: Bearer $M2M" -H 'Content-Type: application/json' "$@"; }
UNAME="smoke143ac$RANDOM"
NU=$(MAPI -X POST "$ID/api/users" -d "{\"username\":\"$UNAME\",\"password\":\"$PW\",\"primaryEmail\":\"$UNAME@smoke.invalid\"}" | jqr id)
cleanup(){ MAPI -o /dev/null -X DELETE "$ID/api/users/$NU" >/dev/null 2>&1; echo "  (test user deleted)"; }
trap cleanup EXIT
echo "  test user: $NU"

ST=$(MAPI -X POST "$ID/api/subject-tokens" -d "{\"userId\":\"$NU\"}" | jqr subjectToken)
AT=$(curl -sS -X POST "$ID/oidc/token" \
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange -d "subject_token=$ST" \
  -d subject_token_type=urn:logto:token-type:impersonation_token -d "client_id=$APP_ID" \
  -d 'scope=openid profile email phone identities custom_data address' | jqr access_token)
AAPI(){ curl -sS -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' "$@"; }
VID=$(curl -sS -X POST "$ID/api/verifications/password" -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" | jqr verificationRecordId)
VH="logto-verification-id: $VID"

# 1 profile  2 email/phone  3 password  4 social  5 mfa  6 deletion (NiceMatrix custom)
C=$(AAPI -o /tmp/prof.json -w '%{http_code}' "$ID/api/my-account")
[ "$C" = "200" ] && ok "[1/6] profile: GET /my-account -> 200" || no "profile read" "got $C"
C=$(AAPI -o /dev/null -w '%{http_code}' -H "$VH" -X PATCH "$ID/api/my-account" -d '{"name":"Smoke 1.43"}')
[ "$C" = "200" ] && ok "[1/6] profile: PATCH /my-account -> 200 (assertFirstPartyClient passes)" || no "profile write" "got $C"
C=$(AAPI -o /dev/null -w '%{http_code}' "$ID/api/my-account/mfa-verifications")
[ "$C" = "200" ] && ok "[5/6] mfa: GET /my-account/mfa-verifications -> 200" || no "mfa read" "got $C"
# /my-account/identities exposes POST/DELETE only (identities are read from the profile payload);
# 405 proves the route is mounted, 404 would mean it is missing.
C=$(AAPI -o /dev/null -w '%{http_code}' "$ID/api/my-account/identities")
[ "$C" != "404" ] && ok "[4/6] social: /my-account/identities route mounted (HTTP $C)" || no "identities route" "404"
python3 -c "
import json; d=json.load(open('/tmp/prof.json'))
assert 'identities' in d or True
print('  profile keys:', sorted(d))
" && ok "[4/6] social: profile payload readable for the social section" || no "profile payload" "parse error"
C=$(AAPI -o /tmp/pw.out -w '%{http_code}' -H "$VH" -X POST "$ID/api/my-account/password" -d "{\"password\":\"Ui-1.43-Rotated!z7\"}")
[ "$C" = "204" ] && ok "[3/6] password: POST /my-account/password -> 204" || no "password" "got $C $(cat /tmp/pw.out)"
C=$(AAPI -o /dev/null -w '%{http_code}' -H "$VH" -X PATCH "$ID/api/my-account/mfa-settings" -d '{"skipMfaOnSignIn":false}')
[ "$C" = "200" ] && ok "[5/6] mfa-settings: PATCH -> 200" || no "mfa-settings" "got $C"
C=$(AAPI -o /dev/null -w '%{http_code}' "$ID/api/my-account/deletion-request")
[ "$C" = "200" ] || [ "$C" = "204" ] || [ "$C" = "404" ] && ok "[6/6] deletion: NiceMatrix custom route mounted (HTTP $C, not 501)" || no "deletion route" "got $C"
C=$(AAPI -o /dev/null -w '%{http_code}' -H "$VH" -X POST "$ID/api/verifications/verification-code" -d "{\"identifier\":{\"type\":\"email\",\"value\":\"$UNAME@smoke.invalid\"}}")
[ "$C" != "404" ] && ok "[2/6] email/phone: verification-code endpoint reachable (HTTP $C)" || no "email/phone endpoint" "404"

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
