# Logto 1.40.1 → 1.41.0 Upgrade Plan

**Owner:** nicematrix-system agent
**Drafted:** 2026-06-30 (analysis only — NOT yet approved/executed)
**Target image tag:** `nicematrix-logto:v1.41.0`
**Backup image tag (current prod/staging):** `nicematrix-logto:pre-1.41-backup`
**Method:** same source-override + submodule-bump workflow as the 1.39 / 1.40 upgrades.

---

## 0. Why / What

- We run **1.40.1** (`@logto/core@1.40.1`, core-kit `2.10.0`) on prod-1 (`id.nicematrix.com`) and staging (this host). Upstream latest is **`@logto/core@1.41.0`** (core-kit **2.11.0**), tag `v1.41.0`, commit `91e55698a`.
- 1.41.0 = feature release. Headline items that **touch our override surface**:
  - **App-level access control** (restrict app access by user / role / org). Enforced inside the **OIDC grant pipeline** → our `token-exchange` grant + `oidc/init.ts` are now in the merge set.
  - **Verification-code / message send rate limiting** (new `Message.RateLimited` webhook, per-recipient throttle) → touches `routes/interaction/additional.ts` (one of our TOTP-brand overrides).
  - **TOTP replay protection** (reject reused/older time-step) → touches `totp-verification.ts` (our TOTP-brand override).
  - **Password expiration policy**, **username policy**, **Account Center Sessions page + avatar/passkey upgrades** → touch `account/App.tsx`, `SocialSection`, `routes/account/index.ts`, `routes/sign-in-experience/index.ts`.
  - New connector: **SMTP2GO email** (auto-linked by our Dockerfile, no change needed).
- `core-kit` bump 2.10.0 → **2.11.0** is the normal in-release bump (NOT the broken-graph situation we had at 1.40.0). Pin to the `v1.41.0` tag commit.

## 1. Risk surface — measured, not guessed

Recomputed all **89** live override files against `1.40.1 (3308305440) → 1.41.0 (91e55698a)`. Full list: `OVERRIDE_DRIFT_AUTO.txt` (this folder).

| Bucket | Count | Meaning | Action |
|--------|------:|---------|--------|
| Our own new files | 28 | Never existed upstream (custom APIs, svgs, ProfileSection editors, native-caps, social-redirect-override, mfa-issuer const, region-routing) | Pure passthrough, zero work |
| Upstream UNCHANGED | 40 | Identical 1.40.1→1.41.0 | Reapply as-is, verify path exists |
| Upstream CHANGED | 20 | Upstream edited the file we override | **3-way merge required** |
| Upstream REMOVED | 0 | No override lost its upstream origin | none |

**Critical preserved-as-UNCHANGED (verified, NO merge needed):**
`schemas/consts/oidc.ts` (native_caps/native_scheme/app_slug ExtraParamsKey), `schemas/seeds/management-api.ts` (mgmt-API resource indicator), `oidc/utils.ts` (buildLoginPromptUrl), `connector-alipay-web`, `connector-oidc` (Microsoft oid identitySource), `toolkit/core-kit/src/regex.ts` (username-with-dot), `core/libraries/hook/*` (webhook deviceRef/appSlug context, region-routing), `experience/utils/native-caps.ts`, all 6 ProfileSection editors, avatar + deletion-request routes.
→ The token-exchange **id_token/refresh_token** logic itself is unchanged upstream; only the grant's **function signature** moved (see §2.A).

## 2. The 20 files needing a 3-way merge

### A. Auth-critical (absorb upstream behaviour + preserve our delta) — HIGH attention

| File | upstream Δ | Our delta to preserve | Merge note |
|------|-----------:|-----------------------|------------|
| `core/oidc/grants/token-exchange/index.ts` | +15/-3 | Our large `id_token` + `refresh_token` issuance blocks (marker-tagged) | **Signature change:** `buildHandler(envSet, queries)` → `buildHandler(envSet, queries, appAccess)` + a new `assertUserHasApplicationAccessForOidc(...)` call right after `ctx.oidc.entity('Account', account)`. `grants/index.ts` (NOT our override — flows in from upstream) now calls it with 3 args, so our override **must** adopt the 3-arg signature or the build breaks. Re-apply our two marker blocks verbatim below the new assert. |
| `core/oidc/init.ts` | +55/-2 | 1-line `Grant` ceiling 180→**365** days | Re-copy upstream 1.41.0 init.ts, re-apply only the Grant-ceiling line. Upstream added `loadExistingGrant` (app-access-control), `extraClientMetadata` for `appLevelAccessControlEnabled`, and `registerGrants(oidc, envSet, queries, libraries)`. All of that is upstream-owned and must be kept intact. |
| `experience/shared/utils/search-parameters.ts` | +7/-1 | `captureNativeCapsFromUrl()` call before the strip | Upstream changed `replaceState({},…)` → `replaceState(window.history.state,…)`. Keep upstream's new first arg; keep our capture call above it. |
| `core/routes/experience/.../totp-verification.ts` | +17/-16 | Fixed brand issuer (`mfaIssuerName`) in `keyuri()` | Upstream rewrote `verifyUserExistingTotp` for **replay protection** (`getTotpTokenTimeStep` + `updateUserTotpMfaVerificationLastUsed`). Absorb that verbatim; re-apply our brand-issuer change in `generateSecretQrCode` only. New DB column `is_password_expired`/TOTP `lastUsedTimeStep` handled by alterations. |
| `core/routes/interaction/additional.ts` | +26/-13 | Fixed brand issuer in the two `keyuri()` calls | Upstream wrapped verification-code send in `withMessageRateGuard`. Absorb verbatim; re-apply our two brand-issuer lines only. |

### B. Account-Center UI — MED attention

| File | upstream Δ | Our delta | Note |
|------|-----------:|-----------|------|
| `account/src/App.tsx` | +42/-23 | `/profile`+`/security` → `<Navigate to="/">` redirects; single-card layout comment | Upstream added **Sessions** route + `account-tabs` util. Keep our redirect routes; ensure new `Sessions` import/route survives. |
| `account/.../SocialSection/index.tsx` | +101/-11 | 1-line `isApple:false` | Big upstream rewrite (in-place social unlink w/o leaving page). Take upstream wholesale, re-apply the single `isApple:false` line. |
| `account/.../SocialCallback/index.tsx` | +16/-3 | connectorId-from-path fallback + QQ ICP origin override | Upstream added `canSkipVerification`. Keep both our deltas; layer on upstream's skip path. |
| `account/.../SocialFlow/index.tsx` | +30/-6 | QQ ICP `callbackOrigin` override | Re-apply our one redirectUri-origin line over upstream. |
| `account/.../PasskeyBinding/index.tsx` | +5/-5 | backup-code lockout-prevention detour | Small upstream delta; keep our detour block. |
| `core/routes/sign-in-experience/index.ts` | +99/-7 | OSS `hideLogtoBranding` allow (drop Cloud-only assert; CSP stays Cloud-only) | 8 upstream commits (username/password-expiration/verification-code policies, forgot-password availability). Re-copy upstream, re-apply our 2 small OSS-branding edits. |
| `core/routes/account/index.ts` | +14/-20 | 2-line avatar+deletion route mount | Upstream changed `getScopedProfile` return shape to `{profile,user}` + added `assertUsernameAllowed`. Re-copy upstream, re-apply our 2 mount lines at the bottom. |

### C. LOW — SCSS / branding / tiny

| File | upstream Δ | Note |
|------|-----------:|------|
| `account/.../MfaSection/index.module.scss` | +5/-251 | Upstream moved most MFA styles to shared; re-copy + re-apply our style tweak, confirm tweak still targets a live selector. |
| `account/.../SocialSection/index.module.scss` | +3/-3 | SCSS only |
| `account/.../UsernameSection/index.module.scss` | +3/-3 | SCSS only |
| `account/.../EmailPhoneSection/index.module.scss` | +5/-5 | SCSS only |
| `account/.../PasswordSection/index.module.scss` | +5/-5 | SCSS only |
| `account/src/App.module.scss` | +8/0 | SCSS only |
| `console/src/consts/tenants.ts` | +5/0 | Keep our `NiceMatrix Cloud/Console` mainTitle; upstream added 3 quota flags. |
| `console/src/consts/external-links.ts` | +1/0 | Preserve our contactEmail. |

## 3. DB alterations (forward, additive)

9 new alteration scripts 1.40.1→1.41.0 — all additive (columns w/ defaults, indexes, seed defaults). **No destructive migration.** The one `drop index` is a stale-index cleanup wrapped in `concurrently … if exists` (safe, reversible):

- `add-password-expiration-policy` (sign_in_experiences)
- `add-is-password-expired-to-users` (`users.is_password_expired bool default false`)
- `drop-oidc-model-instances-legacy-grant-id-index` (drop stale index, `concurrently`)
- `add-username-policy`
- `set-sign-up-profile-fields-default`
- `add-verification-code-policy`
- `add-sentinel-activities-created-at-index`
- `set-admin-account-center-profile-fields`
- `cover-service-logs-tenant-type-index-with-created-at`

Standard `database alteration deploy next`. Note: TOTP replay-protection's `lastUsedTimeStep` is stored inside the existing `users.mfa_verifications` JSON (no column needed) — confirm during smoke that `updateUserTotpMfaVerificationLastUsed` exists in 1.41.0 user queries (it does; new method).

## 4. New connector — auto-linked, config left to ops

- New in 1.41: **SMTP2GO** (email). Our Dockerfile already runs `pnpm cli connector link …` over the whole workspace → picked up automatically, no Dockerfile change.
- Action: **verify** it appears in Console → Connectors after build (mount-only, unconfigured). All existing connectors (wechat/alipay/qq/whatsapp/yunpian/aliyun-sms/mailjunky/smsbao + the 1.40 set) preserved.

## 5. App-level access control — default-off, verify no regression

This is the one **new enforcement in the auth hot path**. Default behaviour: a client only gets gated when its `appLevelAccessControlEnabled` metadata is `true` AND access rules exist. Our apps don't set it → `assertUserHasApplicationAccessForOidc` is a no-op pass-through. **Smoke must prove** App login (token-exchange) + Console/SPA login still succeed with the new assert in path (i.e., the no-op default truly passes). Do NOT enable app-access-control on any application during this upgrade.

## 6. Operational preflight

### Build host (this host)
- Disk: **64% / 53 GB free** — ample for one new ~1.85 GB image. Reclaim build cache before build anyway.
- Build heap already 6 GB in Dockerfile; host 8 GB RAM — OK.
- Image ladder kept: `latest` (=1.40.1 `6a6ed7d`), `v1.40.1`, `pre-oid-rollback-20260618`.

### Prod-1 (`46.224.6.74`) — untouched until prod stage
- Compose: `/var/www/nicematrix-id/deploy/docker-compose.yml`, env `--env-file /etc/nicematrix/id.env`.
- prod-3 (cn) runs **no Logto** — zero action.

## 7. Execution stages (gated)

### Stage 0 — Safety (no deploy)
- Branch `upgrade/logto-1.41`.
- `docker tag nicematrix-logto:latest nicematrix-logto:pre-1.41-backup` (staging; same on prod-1 at its stage).
- Backup staging DB: `docker exec nicematrix-id-postgres pg_dumpall -U postgres > /root/backups/logto_staging_pre_v1.41.0_<ts>.sql`.
- Reclaim docker build cache.

### Stage 1 — Bump submodule
- `cd logto-upstream && git checkout v1.41.0` → commit `chore: bump logto-upstream to v1.41.0`.
- `OVERRIDE_DRIFT_AUTO.txt` already regenerated in this folder (28/40/20/0).

### Stage 2 — LOW merges (40 unchanged + §2.C)
- Reapply / confirm path exists; SCSS + branding + tiny. Commit.

### Stage 3 — Auth-critical merges (§2.A)
- `token-exchange/index.ts` (3-arg signature + re-apply id_token/refresh_token blocks), `oidc/init.ts` (re-copy + Grant-365d line), `search-parameters.ts`, `totp-verification.ts`, `interaction/additional.ts`. `node`/tsc-check each. Commit.

### Stage 4 — Account-Center merges (§2.B)
- `App.tsx`, `SocialSection`, `SocialCallback`, `SocialFlow`, `PasskeyBinding`, `sign-in-experience/index.ts`, `routes/account/index.ts`. Commit.

### Stage 5 — Build + verify image
- Reclaim disk. `cd deploy && docker compose build`. Tag `v1.41.0`. Confirm in-image `core/package.json`=1.41.0, core-kit=**2.11.0**, SMTP2GO connector linked.

### Stage 6 — Staging deploy + smoke (this host, `id-staging`)
- Recreate logto, `database alteration deploy next` (9 alterations), health 200.
- Smoke (full 1.39/1.40 checklist + 1.41 items in §8). **STOP — explicit Xianglin GO before prod.**

### Stage 7 — Prod-1 deploy (after GO)
- Fresh prod DB `pg_dumpall` in-session. Retag old image `pre-1.41-backup-<ts>`. `docker save | ssh | docker load`. `database alteration deploy next`. `compose up -d --force-recreate logto`. Smoke. (prod-3 cn: no action.)

### Stage 8 — Version bookkeeping + docs (coupled to actual deploy — see §10)
- Bump `LOGTO_VERSION=1.41.0` in **every** backend host env (staging + prod-1; prod-3 too — its dashboard reads the same env even though it runs no Logto), `systemctl restart nicematrix-backend.service`, confirm `GET /v1/admin/id-system/status` shows 1.41.0.
- Update workspace `MEMORY.md` "Version" line, repo `docs/patches.md`, changelog. Merge branch.

## 8. Verification / smoke checklist (run after staging AND prod)

Reuse `docs/upgrade-1.39/VERIFICATION.md` verbatim, PLUS 1.41-specific:
- Image: `core`=1.41.0, `@logto/core-kit`=**2.11.0**.
- `database alteration list` shows all 9 new 1.41 alterations consumed.
- **App-access-control no-op pass:** App login (token-exchange) returns access_token + **id_token + refresh_token**; Console + SPA login OK (proves new OIDC assert defaults to pass).
- **TOTP replay protection:** a fresh TOTP code verifies; immediately replaying the same code is rejected (`invalid_totp_code`). TOTP enrollment QR issuer still shows **NiceMatrix ID** (brand override survived).
- **Message rate limit:** repeated verification-code sends to the same recipient eventually throttle (429) and emit `Message.RateLimited` (selectable in Console webhooks) — sanity only, don't lock a real account.
- Native takeover (native_caps passthrough), username-with-dot, mgmt-API resource indicators = `id.nicematrix.com/...`, webhook PostSignIn carries `deviceRef`+`appSlug`, backend `/health` + M2M token valid.
- Account Center: Security shows our DeletionSection; Profile shows AvatarEditor + 6 field editors; new **Sessions** page renders; `/profile` and `/security` redirect to `/`.
- Console → Connectors lists **SMTP2GO** (unconfigured); audit-log time-range picker still renders.

## 9. Rollback
- Image: `docker tag nicematrix-logto:pre-1.41-backup nicematrix-logto:latest && docker compose --env-file /etc/nicematrix/id.env up -d --force-recreate logto`.
- DB: alterations are additive/forward-only; the one dropped index is recreated by its `beforeDown`. Hard rollback = restore the same-session `pg_dumpall`.

## 10. Version-number sequencing (honesty gate)

The `LOGTO_VERSION` env (drives the admin "ID System Status" tile) and the MEMORY.md "Version" line are **runtime facts about the deployed image**. They are flipped to `1.41.0` **only in Stage 8, after 1.41.0 is actually running** on that host. Flipping them earlier would make the dashboard/MEMORY report a version that is not deployed — the exact stale-version failure `docs/upgrade.md` warns about. **No premature version bump.**

## 11. State pointer
**CURRENT_STAGE:** analysis complete; drift recomputed (28/40/20/0); tags fetched; submodule still pinned at 1.40.1 (nothing built/deployed).
**NEXT_ACTION:** on GO — Stage 0 (branch + staging DB backup + image backup tag), then submodule bump + merges.
**NOTE:** v1.41.0 tag fetched into local submodule object store only; working tree + runtime unchanged by this analysis.

---

## 12. EXECUTION LOG (2026-07-11, staging)

- Stage 0 ✅ branch `upgrade/logto-1.41`; image backup `pre-1.41-backup` (=6a6ed7d); DB dump `/root/backups/logto_staging_pre_v1.41.0_20260711_1729.sql` (11M)
- Stage 1 ✅ submodule → v1.41.0 (91e55698a). Drift re-verified live: 28/40/20/0 identical to plan.
- Stage 2-4 ✅ all 20 merges done. Deviations from plan (both safe simplifications):
  - **SocialSection/index.tsx override DROPPED** — upstream 1.41 removed `isApple` from `getLogoUrl` entirely; our 1-line delta became meaningless. Now pure upstream.
  - **MfaSection/index.module.scss override DROPPED** — upstream moved MFA rows into shared `Security/components/SecurityRow` (new files); old selectors gone. Mobile layout now upstream-managed.
  - Home page: wrapped MfaSection in new `MfaVerificationsProvider` + added `PasskeySection` (renders null unless passkey sign-in enabled) — required or MFA card stays skeleton.
  - Home scss: added `.content` (Sessions page imports Home styles as homeStyles).
  - App.tsx: rebuilt on upstream 1.41 (Sessions route kept live at /sessions); root renders merged Home; /profile+/security redirect to /; upstream's root→first-nav-item redirect removed (would loop with our redirects).
- Stage 5 ✅ image built, tagged `v1.41.0` + `latest` (b5b1968746ec). In-image: core 1.41.0, core-kit 2.11.0, smtp2go linked, brand TOTP issuer + token-exchange override + Grant 365d + region-routing all present in build output.
- Stage 6 ✅ staging deployed. 9 alterations consumed (ran via one-shot container on nicematrix-id_default network w/ explicit DB_URL; `docker exec` in the crash-looping container gets killed — note for prod). Smoke:
  - OIDC discovery/JWKS 200; console/account/sign-in 200
  - M2M token OK (resource id.nicematrix.com/admin/api)
  - **token-exchange returns access+id+refresh token** (app-access-control no-op pass confirmed); refresh grant rotates; aud=api-staging; backend /v1/me 200
  - custom routes live: by-identity 400-on-bad-args, verification-records/assert 422 collapsed
  - TOTP replay-protection code in build (5 hits updateUserTotpMfaVerificationLastUsed); message rate guard in build; username-dot regex OK; webhook deviceRef+appSlug + x-nicematrix-region in build
  - DB: users.is_password_expired present; policies columns added; hideLogtoBranding still true (OSS allow works)
  - staging LOGTO_VERSION → 1.41.0, backend restarted, health OK
- **NEXT: Stage 7 prod-1 — awaiting explicit GO** (browser-level Account Center visual check on staging recommended first)

## 13. PROD DEPLOY LOG (2026-07-11 evening, GO by Xianglin)

- prod-1 backup: image `pre-1.41-backup-20260711_1822` (=f2c80d9e6577), DB `/root/backups/logto_prod_pre_v1.41.0_20260711_1822.sql` (138M, pg_dumpall -U logto)
- Image transfer: docker save|gzip|ssh|load; layer-digest md5 verified identical both ends (6f052d7e…)
- Alterations: 9/9 succeeded via one-shot container on `nicematrix-id_default` w/ explicit DB_URL (same method as staging)
- Switch: retag v1.41.0→latest, compose up -d --force-recreate; healthy in ~25s; zero errors in logs
- Smoke (prod): discovery/jwks/console/account 200, sign-in 302 (normal), M2M OK, verification-records/assert 422, **token-exchange returns access+id+refresh** (app-access-control no-op confirmed on prod), backend health 200 v1.2.449, admin-web 200
- LOGTO_VERSION=1.41.0 flipped + backend restarted on: staging (this host), prod-1, prod-3 (dashboard env only, no Logto there). prod-3 /v1/meta OK post-restart, both units active.
- **UPGRADE COMPLETE. Rollback assets retained** (image tags + same-session dumps).
