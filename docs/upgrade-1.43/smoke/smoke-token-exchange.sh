#!/usr/bin/env bash
# Stage 4 smoke items 2 & 3: token-exchange (id_token + refresh_token + dual resource)
# and refresh_token against BOTH the primary and the secondary resource.
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
APP_ID="${APP_ID:-2zxg5iw5pu48eejm88bv1}"      # 乐趣记事本 (Native, first-party)
RES_A="${RES_A:-https://api-staging.nicematrix.com}"
RES_B="${RES_B:-https://api.nicematrix.com}"

pass=0; fail=0
ok(){ echo "  ok   - $1"; pass=$((pass+1)); }
no(){ echo "  FAIL - $1"; echo "         $2"; fail=$((fail+1)); }

jqr(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }

echo "== M2M token =="
M2M=$(curl -sS -X POST "$ID/oidc/token" \
  -u "$M2M_ID:$M2M_SECRET" \
  -d grant_type=client_credentials -d "resource=$MGMT_RES" -d scope=all | jqr access_token)
[ -n "$M2M" ] && ok "management token minted" || { no "management token" "empty"; exit 1; }

USER_ID=$(curl -sS "$ID/api/users?page_size=1" -H "Authorization: Bearer $M2M" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
echo "  user = $USER_ID"

mint_subject(){
  curl -sS -X POST "$ID/api/subject-tokens" -H "Authorization: Bearer $M2M" \
    -H 'Content-Type: application/json' -d "{\"userId\":\"$USER_ID\"}" | jqr subjectToken
}

exchange(){ # $1 = extra curl args
  local st; st=$(mint_subject)
  curl -sS -X POST "$ID/oidc/token" \
    -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
    -d "subject_token=$st" \
    -d subject_token_type=urn:logto:token-type:impersonation_token \
    -d "client_id=$APP_ID" "$@"
}

echo
echo "== case 1: no openid / no offline_access -> upstream-identical body =="
R=$(exchange -d "resource=$RES_A")
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
keys=sorted(d.keys())
assert 'access_token' in d, d
assert 'id_token' not in d, 'id_token leaked without openid'
assert 'refresh_token' not in d, 'refresh_token leaked without offline_access'
print('  keys:', keys)
" && ok "no extra tokens without the scopes" || no "case 1" "$R"

echo
echo "== case 2: openid only -> id_token present, no refresh_token =="
R=$(exchange -d "resource=$RES_A" -d scope=openid)
echo "$R" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
assert d.get('id_token'), 'no id_token'
assert 'refresh_token' not in d, 'refresh_token leaked'
h,p,_=d['id_token'].split('.')
pad=lambda s:s+'='*(-len(s)%4)
hdr=json.loads(base64.urlsafe_b64decode(pad(h)))
pl=json.loads(base64.urlsafe_b64decode(pad(p)))
assert 'typ' not in hdr, 'typ still present in header: %r' % hdr
assert 'at_hash' not in pl, 'at_hash still present: %r' % sorted(pl)
assert pl['aud']=='$APP_ID', pl['aud']
assert pl['iss'].startswith('https://id-staging.nicematrix.com'), pl['iss']
assert pl['sub']=='$USER_ID', pl['sub']
print('  id_token hdr:', hdr)
print('  id_token claims:', sorted(pl))
" && ok "id_token issued; no at_hash, no typ:JWT (v9 contract)" || no "case 2" "$R"

echo
echo "== case 3: offline_access only -> refresh_token, no id_token =="
R=$(exchange -d "resource=$RES_A" -d scope=offline_access)
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('refresh_token'), 'no refresh_token'
assert 'id_token' not in d, 'id_token leaked'
print('  scope:', d.get('scope'))
" && ok "refresh_token issued without openid" || no "case 3" "$R"

echo
echo "== case 4: SINGLE resource + openid + offline_access =="
R=$(exchange -d "resource=$RES_A" -d "scope=openid offline_access")
RT1=$(echo "$R" | jqr refresh_token)
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('id_token') and d.get('refresh_token'), sorted(d)
print('  token_type:', d['token_type'], 'expires_in:', d['expires_in'])
" && ok "both tokens issued (single resource)" || no "case 4" "$R"

RSH=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=refresh_token \
  -d "refresh_token=$RT1" -d "client_id=$APP_ID" -d "resource=$RES_A")
echo "$RSH" | python3 -c "
import sys,json;d=json.load(sys.stdin)
assert d.get('access_token'), d
print('  refreshed aud ok')
" && ok "single-resource refresh works" || no "single-resource refresh" "$RSH"

echo
echo "== case 5: DUAL resource + openid + offline_access =="
R=$(exchange -d "resource=$RES_A" -d "resource=$RES_B" -d "scope=openid offline_access")
RT2=$(echo "$R" | jqr refresh_token)
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('id_token') and d.get('refresh_token'), sorted(d)
" && ok "dual-resource exchange issued both tokens" || no "case 5" "$R"

echo "  -- refresh against PRIMARY ($RES_A)"
RA=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=refresh_token \
  -d "refresh_token=$RT2" -d "client_id=$APP_ID" -d "resource=$RES_A")
RT3=$(echo "$RA" | jqr refresh_token)
echo "$RA" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
assert d.get('access_token'), d
pad=lambda s:s+'='*(-len(s)%4)
pl=json.loads(base64.urlsafe_b64decode(pad(d['access_token'].split('.')[1])))
assert pl['aud']=='$RES_A', pl['aud']
print('  aud =', pl['aud'])
" && ok "refresh -> PRIMARY resource" || no "refresh primary" "$RA"

echo "  -- refresh against SECONDARY ($RES_B) with the rotated RT"
RB=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=refresh_token \
  -d "refresh_token=${RT3:-$RT2}" -d "client_id=$APP_ID" -d "resource=$RES_B")
echo "$RB" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
assert d.get('access_token'), d
pad=lambda s:s+'='*(-len(s)%4)
pl=json.loads(base64.urlsafe_b64decode(pad(d['access_token'].split('.')[1])))
assert pl['aud']=='$RES_B', pl['aud']
print('  aud =', pl['aud'])
" && ok "refresh -> SECONDARY resource (the 2026-08-06 incident case)" || no "refresh secondary" "$RB"

echo
echo "== case 6: subject_token is one-shot =="
ST=$(mint_subject)
for i in 1 2; do
  OUT=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$ID/oidc/token" \
    -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
    -d "subject_token=$ST" -d subject_token_type=urn:logto:token-type:impersonation_token \
    -d "client_id=$APP_ID" -d "resource=$RES_A")
  echo "  attempt $i -> HTTP $OUT"
  [ "$i" = 1 ] && FIRST=$OUT || SECOND=$OUT
done
[ "$FIRST" = "200" ] && [ "$SECOND" = "400" ] && ok "replay rejected (200 then 400)" || no "replay" "$FIRST/$SECOND"

echo
echo "== case 7: account-proxy path (no resource, scope=openid) =="
R=$(exchange -d scope=openid)
echo "$R" | python3 -c "
import sys,json;d=json.load(sys.stdin)
assert d.get('access_token'), d
assert '.' not in d['access_token'], 'expected OPAQUE token, got a JWT'
assert d.get('id_token'), 'no id_token'
print('  opaque account token len:', len(d['access_token']))
" && ok "opaque account token + id_token (backend Account API path)" || no "case 7" "$R"

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
