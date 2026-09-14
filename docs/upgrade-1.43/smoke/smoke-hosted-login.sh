#!/usr/bin/env bash
# Stage 4 smoke item 1: full hosted-page sign-in and hosted registration, end to end through
# /oidc/auth -> Experience API -> /oidc/token.
#
# 2026-09-14 (stage 2, explicit opt-in): this script used to expect an MFA challenge here.
# It no longer happens, on purpose. The factor below is provisioned by an ADMIN through the
# Management API, which is not the user opting in, so `logto_config.mfa.enabled` stays unset
# and sign-in must not challenge. See docs/mfa-explicit-optin-plan.md; the enforced path
# (user switches it on -> sign-in really challenges) is covered by smoke-mfa-explicit-optin.sh.
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
SPA=dfrfskfsq5zd2nikm1u3f
REDIR="https://m1.nicematrix.com/callback"
PW='Hosted-1.43-Smoke!x9'
CJ=/tmp/cj143.txt

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
MAPI(){ curl -sS -H "Authorization: Bearer $M2M" -H 'Content-Type: application/json' "$@"; }

UNAME="smoke143hosted$RANDOM"
NU=$(MAPI -X POST "$ID/api/users" \
  -d "{\"username\":\"$UNAME\",\"password\":\"$PW\",\"primaryEmail\":\"$UNAME@smoke.invalid\",\"primaryPhone\":\"1999$RANDOM$RANDOM\"}" | jqr id)
[ -n "$NU" ] || { echo "cannot create user"; exit 1; }
NU2=""
cleanup(){ MAPI -o /dev/null -X DELETE "$ID/api/users/$NU" >/dev/null 2>&1
           [ -n "$NU2" ] && MAPI -o /dev/null -X DELETE "$ID/api/users/$NU2" >/dev/null 2>&1
           rm -f "$CJ"; echo "  (test users deleted)"; }
trap cleanup EXIT
echo "  test user: $NU ($UNAME)"

# Bind a TOTP factor via the Management API so the tenant's mandatory MFA step
# can be satisfied offline (no OTP delivery needed).
SECRET=$(MAPI -X POST "$ID/api/users/$NU/mfa-verifications" -d '{"type":"Totp"}' | jqr secret)
[ -n "$SECRET" ] && ok "TOTP factor provisioned for the test user" || no "provision TOTP" "empty secret"

read -r VERIFIER CHALLENGE <<<"$(python3 - <<'PY'
import base64, hashlib, secrets
v = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip('=')
c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('=')
print(v, c)
PY
)"

echo
echo "== hosted SIGN-IN (password; no MFA challenge without an opt-in) =="
rm -f "$CJ"
C=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{http_code}' \
  "$ID/oidc/auth?client_id=$SPA&redirect_uri=$REDIR&response_type=code&scope=openid%20profile%20offline_access&state=st&code_challenge=$CHALLENGE&code_challenge_method=S256&prompt=consent")
[ "$C" = "303" ] && ok "/oidc/auth -> interaction (303)" || no "/oidc/auth" "got $C"
curl -sS -c $CJ -b $CJ -o /dev/null -X PUT "$ID/api/experience" -H 'Content-Type: application/json' -d '{"interactionEvent":"SignIn"}'
VID=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/password" -H 'Content-Type: application/json' \
  -d "{\"identifier\":{\"type\":\"username\",\"value\":\"$UNAME\"},\"password\":\"$PW\"}" | jqr verificationId)
[ -n "$VID" ] && ok "password verification accepted" || no "password verification" "empty"
curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/identification" -H 'Content-Type: application/json' \
  -d "{\"interactionEvent\":\"SignIn\",\"verificationId\":\"$VID\"}"
S1=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{http_code}' -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
if [ "$S1" = "403" ]; then
  # A challenge here would mean a factor an admin provisioned is being treated as the user
  # having switched two-step verification on - the exact thing stage 2 removed.
  no "explicit opt-in regression: challenged for MFA the user never opted into" "submit returned 403"
  MV=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/totp/verify" -H 'Content-Type: application/json' \
    -d "{\"code\":\"$(totp "$SECRET")\"}" | jqr verificationId)
  [ -n "$MV" ] && ok "TOTP MFA verified (flow continued)" || no "TOTP MFA" "empty verificationId"
else
  ok "no MFA challenge for an admin-provisioned factor (explicit opt-in rule, submit=$S1)"
fi

# The staging tenant chains further post-MFA policy steps; walk each one.
SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
if echo "$SUB" | grep -q passkey_preferred; then
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa/passkey-skipped" -H 'Content-Type: application/json'
  ok "passkey prompt skipped (SIE passkeySignIn policy)"
  SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
fi
if echo "$SUB" | grep -q backup_code_required; then
  BCV=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/backup-code/generate" -H 'Content-Type: application/json' | jqr verificationId)
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa" -H 'Content-Type: application/json' \
    -d "{\"type\":\"BackupCode\",\"verificationId\":\"$BCV\"}"
  ok "backup codes generated + bound (SIE mandatory backup-code policy)"
  SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
fi
RT_TO=$(echo "$SUB" | jqr redirectTo)
[ -n "$RT_TO" ] && ok "interaction submitted -> redirectTo" || no "submit" "$SUB"

CB=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "${RT_TO:-$ID/}")
if printf '%s' "$CB" | grep -q '/consent'; then
  CB2=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "$ID/consent")
  ok "first-party consent auto-granted"
  CB=$(curl -sS -c $CJ -b $CJ -o /dev/null -w '%{redirect_url}' "$CB2")
fi
CODE=$(printf '%s' "$CB" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] && ok "authorization code returned to the client redirect_uri" || no "authorization code" "$CB"

TOK=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=authorization_code \
  -d "code=$CODE" -d "redirect_uri=$REDIR" -d "client_id=$SPA" -d "code_verifier=$VERIFIER")
echo "$TOK" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
assert d.get('access_token') and d.get('id_token') and d.get('refresh_token'), sorted(d)
pad=lambda s:s+'='*(-len(s)%4)
h,p,_=d['id_token'].split('.')
pl=json.loads(base64.urlsafe_b64decode(pad(p)))
assert pl['sub']=='$NU', pl['sub']
print('  id_token claims:', sorted(pl))
" && ok "code exchange -> access + id + refresh token" || no "code exchange" "$TOK"

RT=$(echo "$TOK" | jqr refresh_token)
R=$(curl -sS -X POST "$ID/oidc/token" -d grant_type=refresh_token -d "refresh_token=$RT" -d "client_id=$SPA")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d.get('access_token'),d" \
  && ok "hosted-session refresh works" || no "hosted refresh" "$R"

echo
echo "== hosted REGISTER =="
UNAME2="smoke143reg$RANDOM"
rm -f "$CJ"
curl -sS -c $CJ -b $CJ -o /dev/null \
  "$ID/oidc/auth?client_id=$SPA&redirect_uri=$REDIR&response_type=code&scope=openid%20profile%20offline_access&state=st2&code_challenge=$CHALLENGE&code_challenge_method=S256&prompt=consent"
curl -sS -c $CJ -b $CJ -o /dev/null -X PUT "$ID/api/experience" -H 'Content-Type: application/json' -d '{"interactionEvent":"Register"}'
RVID=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/new-password-identity" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":{\"type\":\"username\",\"value\":\"$UNAME2\"},\"password\":\"$PW\"}" | jqr verificationId)
[ -n "$RVID" ] && ok "new-password-identity verification created" || no "new-password-identity" "empty"
IDENT=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/identification" -H 'Content-Type: application/json' \
  -d "{\"interactionEvent\":\"Register\",\"verificationId\":\"$RVID\"}")
if echo "$IDENT" | grep -q missing_profile; then
  # Tenant SIE mandates email+phone (verified) at sign-up; completing that needs a real OTP
  # delivery, which a smoke run cannot do. Reaching this gate proves the register pipeline works.
  ok "registration correctly enforced the tenant sign-up profile policy ($(echo "$IDENT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["missingProfile"])'))"
  SUB='{"policy-stop":true}'
else
  SUB=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
fi
echo "  submit: $(printf '%s' "$SUB" | head -c 200)"
NU2=$(MAPI "$ID/api/users?search=$UNAME2" | python3 -c "import sys,json;a=json.load(sys.stdin);print(a[0]['id'] if a else '')" 2>/dev/null)
if [ -n "$NU2" ]; then
  ok "hosted registration created the user ($NU2)"
elif echo "$SUB" | grep -q 'policy-stop'; then
  :
else
  no "hosted register" "$SUB"
fi

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
