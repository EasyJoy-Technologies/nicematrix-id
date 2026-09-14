#!/usr/bin/env bash
# Leftover #2 verification: our own Account API writes (avatar + deletion-request)
# must reject a THIRD-PARTY client with 403 and stay unchanged for a first-party one.
#
# Method: create a throwaway SPA application + user on id-staging, sign in through the
# real hosted flow to get a genuine end-user access token, exercise every write route
# (baseline), then flip THAT application to is_third_party=true and replay the exact
# same token. Only the flag differs between the two passes, so any status change is
# attributable to assertFirstPartyClient alone. Everything is deleted at the end.
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
REDIR="https://m1.nicematrix.com/callback"
PW='FirstParty-Smoke!x9'
CJ=/tmp/cj-firstparty.txt

pass=0; fail=0
ok(){ echo "  ok   - $1"; pass=$((pass+1)); }
no(){ echo "  FAIL - $1"; echo "         $2"; fail=$((fail+1)); }
jqr(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }
totp(){ python3 -c "
import base64,hmac,hashlib,struct,time,sys
s=sys.argv[1]; s+='='*(-len(s)%8)
k=base64.b32decode(s,casefold=True)
c=struct.pack('>Q', int(time.time())//30)
h=hmac.new(k,c,hashlib.sha1).digest()
o=h[-1]&0xf
print('%06d' % ((struct.unpack('>I',h[o:o+4])[0] & 0x7fffffff) % 1000000))
" "$1"; }

M2M=$(curl -sS -X POST "$ID/oidc/token" -u "$M2M_ID:$M2M_SECRET" \
  -d grant_type=client_credentials -d "resource=$MGMT_RES" -d scope=all | jqr access_token)
[ -n "$M2M" ] || { echo "cannot get management token"; exit 1; }
MAPI(){ curl -sS -H "Authorization: Bearer $M2M" -H 'Content-Type: application/json' "$@"; }

APP=$(MAPI -X POST "$ID/api/applications" -d "{\"name\":\"firstparty-smoke-$RANDOM\",\"type\":\"SPA\",\"oidcClientMetadata\":{\"redirectUris\":[\"$REDIR\"],\"postLogoutRedirectUris\":[]},\"customClientMetadata\":{}}" | jqr id)
[ -n "$APP" ] || { echo "cannot create application"; exit 1; }

UNAME="fpsmoke$RANDOM"
NU=$(MAPI -X POST "$ID/api/users" \
  -d "{\"username\":\"$UNAME\",\"password\":\"$PW\",\"primaryEmail\":\"$UNAME@smoke.invalid\",\"primaryPhone\":\"1999$RANDOM$RANDOM\"}" | jqr id)
[ -n "$NU" ] || { echo "cannot create user"; exit 1; }

cleanup(){
  psql_flag false >/dev/null 2>&1
  MAPI -o /dev/null -X DELETE "$ID/api/users/$NU" >/dev/null 2>&1
  MAPI -o /dev/null -X DELETE "$ID/api/applications/$APP" >/dev/null 2>&1
  rm -f "$CJ"
  echo "  (temp app + user deleted)"
}
# psql prints the RETURNING row and then the "UPDATE 1" tag; keep the row only.
psql_flag(){ docker exec nicematrix-id-postgres psql -U logto -d logto -tAc \
  "update applications set is_third_party=$1 where id='$APP' returning is_third_party" | head -1; }
trap cleanup EXIT
echo "  temp app: $APP   temp user: $NU ($UNAME)"

SECRET=$(MAPI -X POST "$ID/api/users/$NU/mfa-verifications" -d '{"type":"Totp"}' | jqr secret)

read -r VERIFIER CHALLENGE <<<"$(python3 - <<'PY'
import base64, hashlib, secrets
v = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip('=')
c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('=')
print(v, c)
PY
)"

echo
echo "== hosted sign-in to mint a real end-user token =="
rm -f "$CJ"
curl -sS -c $CJ -b $CJ -o /dev/null \
  "$ID/oidc/auth?client_id=$APP&redirect_uri=$REDIR&response_type=code&scope=openid%20profile&state=st&code_challenge=$CHALLENGE&code_challenge_method=S256&prompt=consent"
curl -sS -c $CJ -b $CJ -o /dev/null -X PUT "$ID/api/experience" -H 'Content-Type: application/json' -d '{"interactionEvent":"SignIn"}'
VID=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/password" -H 'Content-Type: application/json' \
  -d "{\"identifier\":{\"type\":\"username\",\"value\":\"$UNAME\"},\"password\":\"$PW\"}" | jqr verificationId)
curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/identification" -H 'Content-Type: application/json' \
  -d "{\"interactionEvent\":\"SignIn\",\"verificationId\":\"$VID\"}"
S1=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{http_code}' -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
if [ "$S1" = "403" ]; then
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/verification/totp/verify" -H 'Content-Type: application/json' \
    -d "{\"code\":\"$(totp "$SECRET")\"}"
fi
# The staging tenant chains further post-MFA policy steps; walk each one (same as
# smoke-hosted-login.sh).
SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
if echo "$SUB" | grep -q passkey_preferred; then
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa/passkey-skipped" -H 'Content-Type: application/json'
  SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
fi
if echo "$SUB" | grep -q backup_code_required; then
  BCV=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/backup-code/generate" -H 'Content-Type: application/json' | jqr verificationId)
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa" -H 'Content-Type: application/json' \
    -d "{\"type\":\"BackupCode\",\"verificationId\":\"$BCV\"}"
  SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
fi
RT=$(echo "$SUB" | jqr redirectTo)
[ -n "$RT" ] && ok "interaction submitted -> redirectTo" || no "submit" "$SUB"
LOC=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "${RT:-$ID/}")
if printf '%s' "$LOC" | grep -q '/consent'; then
  LOC2=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "$ID/consent")
  LOC=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "$LOC2")
fi
CODE=$(printf '%s' "$LOC" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] && ok "authorization code obtained" || no "authorization code" "redirect=$LOC"
AT=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=authorization_code -d "client_id=$APP" \
  -d "code=$CODE" -d "redirect_uri=$REDIR" -d "code_verifier=$VERIFIER" | jqr access_token)
[ -n "$AT" ] && ok "end-user access token issued" || { no "access token" "empty"; echo; echo "pass=$pass fail=$fail"; exit 1; }

AAPI(){ curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AT" "$@"; }
probe(){ # $1 label expectation-set
  GET=$(AAPI "$ID/api/my-account/deletion-request")
  DELREQ=$(AAPI -X DELETE "$ID/api/my-account/deletion-request")
  POSTREQ=$(AAPI -X POST "$ID/api/my-account/deletion-request" -H 'Content-Type: application/json' -d '{}')
  CONFIRM=$(AAPI -X POST "$ID/api/my-account/deletion-request/confirm" -H 'Content-Type: application/json' -d '{"confirmation_token":"0123456789abcdef"}')
  DELAVA=$(AAPI -X DELETE "$ID/api/my-account/avatar")
  POSTAVA=$(AAPI -X POST "$ID/api/my-account/avatar" -F 'file=@/etc/hostname;type=image/png')
  echo "$GET $DELREQ $POSTREQ $CONFIRM $DELAVA $POSTAVA"
}

echo
echo "== pass 1: FIRST-PARTY application (baseline) =="
read -r GET DELREQ POSTREQ CONFIRM DELAVA POSTAVA <<<"$(probe)"
echo "  GET=$GET DELETE-req=$DELREQ POST-req=$POSTREQ confirm=$CONFIRM DELETE-avatar=$DELAVA POST-avatar=$POSTAVA"
[ "$GET" = "200" ] && ok "GET deletion-request 200" || no "GET deletion-request" "got $GET"
[ "$DELREQ" = "204" ] && ok "DELETE deletion-request 204" || no "DELETE deletion-request" "got $DELREQ"
[ "$DELAVA" = "200" ] && ok "DELETE avatar 200" || no "DELETE avatar" "got $DELAVA"
[ "$POSTREQ" != "403" ] && ok "POST deletion-request not 403 (reaches its own gate: $POSTREQ)" || no "POST deletion-request" "403 as first party"
[ "$CONFIRM" != "403" ] && ok "POST confirm not 403 (reaches its own gate: $CONFIRM)" || no "POST confirm" "403 as first party"
[ "$POSTAVA" != "403" ] && ok "POST avatar not 403 (reaches its own gate: $POSTAVA)" || no "POST avatar" "403 as first party"

echo
echo "== flip the SAME application to third-party =="
FLIP=$(psql_flag true | tr -d '[:space:]')
[ "$FLIP" = "t" ] && ok "applications.is_third_party = true" || no "flip" "got '$FLIP'"
docker restart nicematrix-logto >/dev/null
for i in $(seq 1 24); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' nicematrix-logto)" = "healthy" ] && break; sleep 5
done

echo
echo "== pass 2: same token, THIRD-PARTY application =="
read -r GET2 DELREQ2 POSTREQ2 CONFIRM2 DELAVA2 POSTAVA2 <<<"$(probe)"
echo "  GET=$GET2 DELETE-req=$DELREQ2 POST-req=$POSTREQ2 confirm=$CONFIRM2 DELETE-avatar=$DELAVA2 POST-avatar=$POSTAVA2"
[ "$DELREQ2" = "403" ] && ok "DELETE deletion-request -> 403" || no "DELETE deletion-request" "got $DELREQ2"
[ "$POSTREQ2" = "403" ] && ok "POST deletion-request -> 403" || no "POST deletion-request" "got $POSTREQ2"
[ "$CONFIRM2" = "403" ] && ok "POST confirm -> 403" || no "POST confirm" "got $CONFIRM2"
[ "$DELAVA2" = "403" ] && ok "DELETE avatar -> 403" || no "DELETE avatar" "got $DELAVA2"
[ "$POSTAVA2" = "403" ] && ok "POST avatar -> 403" || no "POST avatar" "got $POSTAVA2"
[ "$GET2" = "200" ] && ok "GET deletion-request still 200 (read path untouched)" || no "GET deletion-request" "got $GET2"

echo
echo "== restore =="
BACK=$(psql_flag false | tr -d '[:space:]')
[ "$BACK" = "f" ] && ok "applications.is_third_party = false" || no "restore" "got '$BACK'"

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
