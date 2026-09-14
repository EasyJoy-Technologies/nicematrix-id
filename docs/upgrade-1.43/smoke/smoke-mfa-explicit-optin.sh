#!/usr/bin/env bash
# Stage 2 (explicit opt-in) verification — docs/mfa-explicit-optin-plan.md §9, items 1-11.
#
# Proves the one property the whole change is about: what /mfa-settings reports is exactly
# what the hosted sign-in flow does. Every "switch is on/off" assertion below is paired with
# a real hosted sign-in that either is or is not challenged for a second factor.
set -uo pipefail

ID="https://id-staging.nicematrix.com"
ENVF=/etc/nicematrix/backend.env
M2M_ID=$(grep '^LOGTO_M2M_CLIENT_ID=' $ENVF | cut -d= -f2-)
M2M_SECRET=$(grep '^LOGTO_M2M_CLIENT_SECRET=' $ENVF | cut -d= -f2-)
MGMT_RES=$(grep '^LOGTO_API_RESOURCE=' $ENVF | cut -d= -f2-)
APP_ID=luckh1qjgg76zidyaipk6                 # first-party app used for account tokens
SPA=dfrfskfsq5zd2nikm1u3f                    # staging SPA used for hosted sign-in
REDIR="https://m1.nicematrix.com/callback"
PW='Optin-Smoke-2026!x9'
CJ=/tmp/cj-optin.txt

pass=0; fail=0
ok(){ echo "  ok   - $1"; pass=$((pass+1)); }
no(){ echo "  FAIL - $1"; echo "         $2"; fail=$((fail+1)); }
hdr(){ echo; echo "== $1 =="; }
jqr(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }
psqlq(){ docker exec nicematrix-id-postgres psql -U logto -d logto -At -c "$1"; }
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
[ -n "$M2M" ] || { echo "no m2m token"; exit 1; }
MAPI(){ curl -sS -H "Authorization: Bearer $M2M" -H 'Content-Type: application/json' "$@"; }

# `mkuser` is called through $(...) so it cannot append to a shell variable in this process.
# Created ids are journalled to a file instead, which also means an interrupted run still
# cleans up on the next invocation.
USERFILE=/tmp/optin-smoke-users.txt
: > "$USERFILE"
cleanup(){ local n=0
  while read -r u; do [ -n "$u" ] || continue
    MAPI -o /dev/null -X DELETE "$ID/api/users/$u" >/dev/null 2>&1; n=$((n+1))
  done < "$USERFILE"
  rm -f "$CJ" "$USERFILE"; echo; echo "  ($n test users deleted)"; }
trap cleanup EXIT

mkuser(){ # $1=suffix  $2=extra json ; echoes "<id> <username>"
  local n="optin$1$RANDOM" body extra="${2:-}"
  body="{\"username\":\"$n\",\"password\":\"$PW\"${extra:+,$extra}}"
  local id; id=$(MAPI -X POST "$ID/api/users" -d "$body" | jqr id)
  echo "$id" >> "$USERFILE"; echo "$id $n"
}

acct_token(){ # $1=userId -> account access token
  local st; st=$(MAPI -X POST "$ID/api/subject-tokens" -d "{\"userId\":\"$1\"}" | jqr subjectToken)
  curl -sS -X POST "$ID/oidc/token" \
    -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
    -d "subject_token=$st" -d subject_token_type=urn:logto:token-type:impersonation_token \
    -d "client_id=$APP_ID" -d 'scope=openid identities' | jqr access_token
}
vrec(){ # $1=account token -> verification record id (password)
  curl -sS -X POST "$ID/api/verifications/password" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" | jqr verificationRecordId
}
settings(){ curl -sS "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $1"; }
mfacfg(){ psqlq "select coalesce(logto_config->'mfa','{}'::jsonb)::text from users where id='$1';"; }

# assert_settings <json> <isEnabled> <hasUsableFactor> <label>
assert_settings(){
  local got_e got_h
  got_e=$(printf '%s' "$1" | jqr isEnabled); got_h=$(printf '%s' "$1" | jqr hasUsableFactor)
  if [ "$got_e" = "$2" ] && [ "$got_h" = "$3" ]; then
    ok "$4 (isEnabled=$got_e hasUsableFactor=$got_h)"
  else
    no "$4" "expected isEnabled=$2 hasUsableFactor=$3, got: $1"
  fi
}

# hosted_signin <username> <totpSecretOrEmpty> -> prints a result line into $HS_RESULT
# HS_MFA_DEMANDED=1 when the flow was challenged for a second factor.
# HS_SUGGESTED=1 when the "set up two-step verification" page was thrown.
# HS_FACTORS holds the availableFactors offered at the challenge.
hosted_signin(){
  local uname="$1" secret="${2:-}" vid s body
  HS_MFA_DEMANDED=0; HS_SUGGESTED=0; HS_FACTORS=""; HS_DONE=0
  read -r VERIFIER CHALLENGE <<<"$(python3 - <<'PY'
import base64, hashlib, secrets
v = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip('=')
print(v, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('='))
PY
)"
  rm -f "$CJ"
  curl -sS -c $CJ -b $CJ -o /dev/null \
    "$ID/oidc/auth?client_id=$SPA&redirect_uri=$REDIR&response_type=code&scope=openid%20profile%20offline_access&state=st&code_challenge=$CHALLENGE&code_challenge_method=S256&prompt=consent"
  curl -sS -c $CJ -b $CJ -o /dev/null -X PUT "$ID/api/experience" \
    -H 'Content-Type: application/json' -d '{"interactionEvent":"SignIn"}'
  vid=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/password" \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":{\"type\":\"username\",\"value\":\"$uname\"},\"password\":\"$PW\"}" | jqr verificationId)
  curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/identification" \
    -H 'Content-Type: application/json' -d "{\"interactionEvent\":\"SignIn\",\"verificationId\":\"$vid\"}"

  # Walk whatever policy steps the tenant chains, up to a bounded number of rounds.
  for _ in 1 2 3 4 5 6; do
    body=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
    if echo "$body" | grep -q 'require_mfa_verification'; then
      HS_MFA_DEMANDED=1
      HS_FACTORS=$(printf '%s' "$body" | python3 -c "import sys,json;print(','.join(json.load(sys.stdin).get('data',{}).get('availableFactors',[])))" 2>/dev/null)
      [ -n "$secret" ] || break
      curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/verification/totp/verify" \
        -H 'Content-Type: application/json' -d "{\"code\":\"$(totp "$secret")\"}"
      continue
    fi
    if echo "$body" | grep -q 'suggest_mfa'; then HS_SUGGESTED=1; break; fi
    if echo "$body" | grep -q 'passkey_preferred'; then
      curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa/passkey-skipped" -H 'Content-Type: application/json'
      continue
    fi
    if echo "$body" | grep -q 'suggest_additional_mfa'; then
      curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa/additional-binding-suggestion-skipped" -H 'Content-Type: application/json'
      continue
    fi
    if echo "$body" | grep -q 'backup_code_required'; then
      s=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/backup-code/generate" -H 'Content-Type: application/json' | jqr verificationId)
      curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa" \
        -H 'Content-Type: application/json' -d "{\"type\":\"BackupCode\",\"verificationId\":\"$s\"}"
      continue
    fi
    if echo "$body" | grep -q 'missing_mfa'; then HS_SUGGESTED=2; break; fi
    if [ -n "$(printf '%s' "$body" | jqr redirectTo)" ]; then HS_DONE=1; break; fi
    break
  done
  HS_BODY="$body"
}

########################################################################
hdr "item 1 + 2 — a user with only email/phone: switch off, greyed out, and sign-in never challenges"
read -r U1 N1 <<<"$(mkuser a "\"primaryEmail\":\"optin$RANDOM@smoke.invalid\",\"primaryPhone\":\"1999$RANDOM$RANDOM\"")"
echo "  user: $U1 ($N1) — has primaryEmail + primaryPhone, no bound factor"
AT1=$(acct_token "$U1")
BEFORE=$(mfacfg "$U1"); echo "  logto_config.mfa BEFORE = $BEFORE"
S=$(settings "$AT1"); echo "  /mfa-settings = $S"
assert_settings "$S" False False "item 1: new user reads off + not switchable"
[ "$(printf '%s' "$S" | python3 -c 'import sys,json;print(json.load(sys.stdin)["usableFactors"])')" = "[]" ] \
  && ok "usableFactors is empty" || no "usableFactors" "$S"

hosted_signin "$N1"
[ "$HS_MFA_DEMANDED" = "0" ] && ok "item 2: hosted sign-in did NOT ask for an SMS/email code" \
  || no "item 2: implicit 2FA still enforced" "factors offered: $HS_FACTORS"
[ "$HS_SUGGESTED" = "0" ] && ok "item 2: no new nagging either (suggestion page not thrown)" \
  || echo "  note - suggestion page was thrown (skippable, see plan §3.4)"
AFTER=$(mfacfg "$U1"); echo "  logto_config.mfa AFTER  = $AFTER"
if echo "$AFTER" | grep -q '"enabled"'; then
  no "item 2 CORE: silent back-fill still happens" "$AFTER"
else
  ok "item 2 CORE: mfa.enabled was NOT written by signing in (back-fill removed)"
fi

hdr "item 3 — adding a factor in the Account Center does not switch anything on"
VR=$(vrec "$AT1")
SECRET=$(python3 -c "import base64,secrets;print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip('='))")
C=$(curl -sS -o /tmp/optin.out -w '%{http_code}' -X POST "$ID/api/my-account/mfa-verifications" \
  -H "Authorization: Bearer $AT1" -H "logto-verification-id: $VR" -H 'Content-Type: application/json' \
  -d "{\"type\":\"Totp\",\"secret\":\"$SECRET\"}")
[ "$C" = "204" ] && ok "TOTP bound through the Account API" || no "TOTP bind" "HTTP $C $(cat /tmp/optin.out)"
AFTER3=$(mfacfg "$U1"); echo "  logto_config.mfa = $AFTER3"
echo "$AFTER3" | grep -q '"enabled"' && no "item 3 CORE: binding wrote mfa.enabled" "$AFTER3" \
  || ok "item 3 CORE: binding a factor left mfa.enabled unwritten"
S=$(settings "$AT1"); echo "  /mfa-settings = $S"
assert_settings "$S" False True "item 3: still off, but now switchable"

hdr "item 11 + guard — legacy payload still works; turning on without a factor is refused"
C=$(curl -sS -o /tmp/optin.out -w '%{http_code}' -X PATCH "$ID/api/my-account/mfa-settings" \
  -H "Authorization: Bearer $AT1" -H "logto-verification-id: $VR" -H 'Content-Type: application/json' \
  -d '{"skipMfaOnSignIn":true}')
if [ "$C" = "200" ] && grep -q isEnabled /tmp/optin.out; then
  ok "item 11: legacy {skipMfaOnSignIn} body still accepted, response carries the new fields"
else
  no "item 11: legacy client broken" "HTTP $C $(cat /tmp/optin.out)"
fi
read -r UG NG <<<"$(mkuser g)"
ATG=$(acct_token "$UG"); VRG=$(vrec "$ATG")
C=$(curl -sS -o /tmp/optin.out -w '%{http_code}' -X PATCH "$ID/api/my-account/mfa-settings" \
  -H "Authorization: Bearer $ATG" -H "logto-verification-id: $VRG" -H 'Content-Type: application/json' \
  -d '{"isEnabled":true}')
[ "$C" = "400" ] && ok "guard: enabling with no bound factor -> 400" || no "guard" "HTTP $C $(cat /tmp/optin.out)"

hdr "item 4 + 9 + 10 — switching on really makes sign-in challenge, with email/phone as fallback"
S=$(curl -sS -X PATCH "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $AT1" \
  -H "logto-verification-id: $VR" -H 'Content-Type: application/json' -d '{"isEnabled":true}')
echo "  PATCH response = $S"
assert_settings "$S" True True "item 4: switch reports on"
CFG=$(mfacfg "$U1"); echo "  logto_config.mfa = $CFG"
echo "$CFG" | grep -q '"enabled": *true' && echo "$CFG" | grep -q '"skipMfaOnSignIn": *false' \
  && ok "item 4: both flags written together (enabled=true, skipMfaOnSignIn=false)" \
  || no "item 4: flag pair inconsistent" "$CFG"

hosted_signin "$N1" "$SECRET"
[ "$HS_MFA_DEMANDED" = "1" ] && ok "item 4 CORE: sign-in really demanded a second factor" \
  || no "item 4 CORE: switch says on but sign-in did not challenge" "$HS_BODY"
echo "  availableFactors at the challenge = $HS_FACTORS"
case "$HS_FACTORS" in
  *EmailVerificationCode*|*PhoneVerificationCode*)
    ok "item 9: email/phone still offered as fallback channels (Package A intact)";;
  *) no "item 9: fallback channels missing" "$HS_FACTORS";;
esac
[ "$HS_DONE" = "1" ] && ok "item 4: TOTP satisfied the challenge and sign-in completed" \
  || echo "  note - flow ended at: $(printf '%s' "$HS_BODY" | head -c 160)"
S=$(settings "$AT1")
assert_settings "$S" True True "item 10: /mfa-settings still agrees after a real sign-in"

hdr "item 5 — switching off really stops the challenge"
VR=$(vrec "$AT1")
S=$(curl -sS -X PATCH "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $AT1" \
  -H "logto-verification-id: $VR" -H 'Content-Type: application/json' -d '{"isEnabled":false}')
assert_settings "$S" False True "item 5: switch reports off (factor still bound)"
CFG=$(mfacfg "$U1")
echo "$CFG" | grep -q '"enabled": *false' && echo "$CFG" | grep -q '"skipMfaOnSignIn": *true' \
  && ok "item 5: both flags written together (enabled=false, skipMfaOnSignIn=true)" \
  || no "item 5: flag pair inconsistent" "$CFG"
hosted_signin "$N1" "$SECRET"
[ "$HS_MFA_DEMANDED" = "0" ] && ok "item 5 CORE: sign-in no longer challenges" \
  || no "item 5 CORE: still challenged after switching off" "$HS_FACTORS"
[ "$HS_SUGGESTED" = "0" ] && ok "item 5: the user who just switched it off is not nagged to set it up" \
  || no "item 5: nagged right after opting out" "$HS_BODY"

hdr "item 6 — deleting the last usable factor turns the switch off and greys it out"
VR=$(vrec "$AT1")
curl -sS -o /dev/null -X PATCH "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $AT1" \
  -H "logto-verification-id: $VR" -H 'Content-Type: application/json' -d '{"isEnabled":true}'
for vid in $(MAPI "$ID/api/users/$U1/mfa-verifications" | python3 -c "import sys,json;print(' '.join(v['id'] for v in json.load(sys.stdin)))"); do
  curl -sS -o /dev/null -X DELETE "$ID/api/my-account/mfa-verifications/$vid" \
    -H "Authorization: Bearer $AT1" -H "logto-verification-id: $VR"
done
CFG=$(mfacfg "$U1"); echo "  logto_config.mfa = $CFG"
echo "$CFG" | grep -q '"enabled": *false' \
  && ok "item 6: mfa.enabled written back to false" || no "item 6: stale enabled=true left behind" "$CFG"
S=$(settings "$AT1")
assert_settings "$S" False False "item 6: switch off and greyed out again"

hdr "item 7 — binding a factor inside the sign-in flow counts as opting in (decision B1)"
# The staging tenant's sign-up policy requires email+phone, so every account that can sign in
# also carries the implicit email/phone factors - which, by design (plan §3.4), means the
# "set up two-step verification" page is not thrown at them (item 2 asserted exactly that).
# So this drives the two endpoints that page drives, in a real sign-in interaction, and then
# checks the state it leaves behind and how the NEXT sign-in behaves.
read -r U2 N2 <<<"$(mkuser b "\"primaryEmail\":\"optin$RANDOM@smoke.invalid\",\"primaryPhone\":\"1999$RANDOM$RANDOM\"")"
echo "  user: $U2 ($N2)"
hosted_signin "$N2"
TS=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/totp/secret" -H 'Content-Type: application/json')
TSEC=$(printf '%s' "$TS" | jqr secret); TVID=$(printf '%s' "$TS" | jqr verificationId)
[ -n "$TSEC" ] && ok "setup page: new TOTP secret issued inside the interaction" || no "totp secret" "$TS"
curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/verification/totp/verify" \
  -H 'Content-Type: application/json' -d "{\"verificationId\":\"$TVID\",\"code\":\"$(totp "$TSEC")\"}"
C=$(curl -sS -c $CJ -b $CJ -o /tmp/optin.out -w '%{http_code}' -X POST "$ID/api/experience/profile/mfa" \
  -H 'Content-Type: application/json' -d "{\"type\":\"Totp\",\"verificationId\":\"$TVID\"}")
[ "$C" = "204" ] && ok "setup page: factor bound through the sign-in flow" || no "bind in flow" "HTTP $C $(cat /tmp/optin.out)"
for _ in 1 2 3 4; do
  B=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json')
  if echo "$B" | grep -q 'backup_code_required'; then
    V=$(curl -sS -c $CJ -b $CJ -X POST "$ID/api/experience/verification/backup-code/generate" -H 'Content-Type: application/json' | jqr verificationId)
    curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa" \
      -H 'Content-Type: application/json' -d "{\"type\":\"BackupCode\",\"verificationId\":\"$V\"}"; continue
  fi
  if echo "$B" | grep -q 'passkey_preferred'; then
    curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/profile/mfa/passkey-skipped" -H 'Content-Type: application/json'; continue
  fi
  break
done
CFG=$(mfacfg "$U2"); echo "  logto_config.mfa = $CFG"
echo "$CFG" | grep -q '"enabled": *true' \
  && ok "item 7 CORE: finishing the setup flow wrote mfa.enabled=true (decision B1)" \
  || no "item 7 CORE: opting in through the setup flow did not stick" "$CFG"
AT2=$(acct_token "$U2")
S=$(settings "$AT2"); echo "  /mfa-settings = $S"
assert_settings "$S" True True "item 7: switch now reads on"
hosted_signin "$N2" "$TSEC"
[ "$HS_MFA_DEMANDED" = "1" ] \
  && ok "item 7 CORE: the next sign-in really demanded a second factor" \
  || no "item 7 CORE: switch says on but sign-in did not challenge" "$HS_BODY"

hdr "item 8 — skipping is remembered and never switches anything on"
read -r U3 N3 <<<"$(mkuser c "\"primaryEmail\":\"optin$RANDOM@smoke.invalid\",\"primaryPhone\":\"1999$RANDOM$RANDOM\"")"
hosted_signin "$N3"
C=$(curl -sS -c $CJ -b $CJ -o /tmp/optin.out -w '%{http_code}' -X POST "$ID/api/experience/profile/mfa/mfa-skipped" -H 'Content-Type: application/json')
[ "$C" = "204" ] && ok "skip accepted (policy is user-controlled)" || no "skip" "HTTP $C $(cat /tmp/optin.out)"
curl -sS -c $CJ -b $CJ -o /dev/null -X POST "$ID/api/experience/submit" -H 'Content-Type: application/json'
CFG=$(mfacfg "$U3"); echo "  logto_config.mfa = $CFG"
echo "$CFG" | grep -q '"skipped": *true' && ok "item 8: mfa.skipped=true persisted" \
  || no "item 8: skip not persisted" "$CFG"
echo "$CFG" | grep -q '"enabled": *true' && no "item 8: skipping also switched it ON" "$CFG" \
  || ok "item 8: skipping did not switch anything on"

hdr "item 12 — the legacy ENABLE payload is a no-op, and says so in its own response"
# Added 2026-09-14 after the fact. Item 11 only covered the legacy OFF direction
# ({skipMfaOnSignIn:true}); the ON direction was never tested, and that is exactly what every
# native client sends today. With the silent back-fill gone, {skipMfaOnSignIn:false} writes only
# half of the state, so it can no longer switch anything on. That is intended — `mfa.enabled` is
# the user's own decision and this body never expressed it — but it IS a client-visible break,
# so it is pinned here: the response must keep telling the caller the truth (isEnabled=false)
# even while returning 200, and sign-in must stay unchallenged.
read -r UL NL <<<"$(mkuser l)"
ATL=$(acct_token "$UL"); VRL=$(vrec "$ATL")
LSEC=$(python3 -c "import base64,secrets;print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip('='))")
curl -sS -o /dev/null -X POST "$ID/api/my-account/mfa-verifications" -H "Authorization: Bearer $ATL" \
  -H "logto-verification-id: $VRL" -H 'Content-Type: application/json' -d "{\"type\":\"Totp\",\"secret\":\"$LSEC\"}"
VRL=$(vrec "$ATL")
S=$(curl -sS -X PATCH "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $ATL" \
  -H "logto-verification-id: $VRL" -H 'Content-Type: application/json' -d '{"skipMfaOnSignIn":false}')
echo "  PATCH {skipMfaOnSignIn:false} = $S"
CFG=$(mfacfg "$UL"); echo "  logto_config.mfa = $CFG"
assert_settings "$S" False True "item 12: legacy enable payload reports it did NOT switch on"
echo "$CFG" | grep -q '"enabled"' \
  && no "item 12 CORE: legacy payload wrote mfa.enabled behind the user's back" "$CFG" \
  || ok "item 12 CORE: legacy payload left mfa.enabled unwritten"
hosted_signin "$NL" "$LSEC"
[ "$HS_MFA_DEMANDED" = "0" ] \
  && ok "item 12: sign-in stayed unchallenged — report and behaviour agree" \
  || no "item 12: sign-in challenged although /mfa-settings said off" "$HS_BODY"
# And the same user opts in properly -> the switch works. Proves the no-op is the payload's
# fault, not a broken account.
VRL=$(vrec "$ATL")
S=$(curl -sS -X PATCH "$ID/api/my-account/mfa-settings" -H "Authorization: Bearer $ATL" \
  -H "logto-verification-id: $VRL" -H 'Content-Type: application/json' -d '{"isEnabled":true}')
assert_settings "$S" True True "item 12: same user, {isEnabled:true} does switch on"
hosted_signin "$NL" "$LSEC"
[ "$HS_MFA_DEMANDED" = "1" ] \
  && ok "item 12: and then sign-in really is challenged (factors: $HS_FACTORS)" \
  || no "item 12: isEnabled=true did not reach the sign-in flow" "$HS_BODY"

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
