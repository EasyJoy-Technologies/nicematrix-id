# Logto 1.39.0 → 1.40.1 Upgrade Plan

**Owner:** nicematrix-system agent
**Drafted:** 2026-05-30 (analysis only — NOT yet approved/executed)
**Target image tag:** `nicematrix-logto:v1.40.1`
**Backup image tag (current prod):** `nicematrix-logto:pre-1.40-backup`
**Method:** same source-override + submodule-bump workflow as the 1.39 upgrade.

---

## 0. Why / What

- Upstream latest is **`@logto/core@1.40.1`** (released 2026-05-29). We run **1.39.0** on prod-1 (`id.nicematrix.com`) and staging (this host).
- 1.40.0 = feature release (audit-log time-range picker, org membership webhook deltas, org-scale indexes, air-gapped `--dapc` flag, new connectors: MailJunky / SMSBao / Aliyun-SMS-MAS, Aliyun Direct Mail regions, richer WeCom, **Custom UI CSP**, **protected-app additional scopes**, **application access control**).
- 1.40.1 = patch fixing a missed `@logto/core-kit` version bump (2.9.0 → 2.10.0). **Pin to 1.40.1, never 1.40.0** (1.40.0 ships a broken package graph).

## 1. Risk surface — measured, not guessed

Diffed all 77 override files against upstream `1.39.0 → 1.40.1`:

| Bucket | Count | Meaning | Action |
|--------|------:|---------|--------|
| Our own new files | 24 | Never existed upstream (custom APIs, svgs, ProfileSection editors, native-caps, social-redirect-override) | Pure passthrough, zero work |
| Upstream UNCHANGED | 36 | Upstream file identical 1.39→1.40 | Reapply as-is, verify path exists |
| Upstream CHANGED | 16 | Upstream edited the file we override | **3-way merge required** |
| Upstream REMOVED | 0 | No override lost its upstream origin | none |

**All critical auth/identity overrides are in the UNCHANGED bucket** (verified):
`token-exchange/index.ts`, `oidc/utils.ts`, `schemas/consts/oidc.ts`, `schemas/seeds/management-api.ts` (mgmt API indicator), `experience/shared/utils/search-parameters.ts` (native_caps passthrough), `connector-alipay-web/src/index.ts`, `toolkit/core-kit/src/regex.ts` (username dot).
→ The token-exchange / native-caps / management-API-resource / WeChat-native work from the last weeks is **not touched** by this upgrade.

## 2. The 16 files needing a 3-way merge (sized by upstream churn)

| File | upstream Δ | Risk | Notes |
|------|-----------:|------|-------|
| `account/src/pages/Profile/index.tsx` | +126/-11 | **HIGH** | Upstream added profile-fields config UI; we render our 6 custom field editors here. Biggest merge. |
| `account/src/App.tsx` | +66/-82 | **HIGH** | 6 commits; routing/layout churn. We have SocialCallback early-return hack — must preserve. |
| `account/src/pages/SocialCallback/index.tsx` | +60/-20 | **HIGH** | 3 commits. Our connectorId-from-path fallback must survive. |
| `account/src/pages/SocialFlow/index.tsx` | +54/-2 | MED | Our QQ/social override; upstream hunks near our edit lines — review overlap. |
| `account/src/pages/Security/SocialSection/index.tsx` | +40/-19 | MED | Try upstream native version first; fall back to override if bind/unbind regresses. |
| `core/src/routes/sign-in-experience/index.ts` | +30/-3 | MED | 3 commits incl. CSP + profile-fields. Our 1-line hideLogtoBranding OSS allow must rebase. |
| `core/src/routes/account/index.ts` | +19/-5 | MED | 2 commits. Our 2-line avatar+deletion route mount must rebase. |
| `account/src/pages/Security/MfaSection/index.module.scss` | +106/-0 | LOW | SCSS only (our override is style tweak). |
| `account/src/pages/Security/SocialSection/index.module.scss` | +31/-8 | LOW | SCSS only. |
| `account/src/App.module.scss` | +9/-1 | LOW | SCSS only. |
| `account/src/components/PageHeader/index.module.scss` | +7/-0 | LOW | SCSS only. |
| `account/src/pages/Security/index.tsx` | +5/-11 | LOW | Our DeletionSection swap; small upstream delta. |
| `console/src/consts/external-links.ts` | +4/-0 | LOW | 2 OSS-upsell links added; preserve our contactEmail. |
| `console/src/App.tsx` | +2/-0 | LOW | Tiny. |
| `console/src/containers/OssOnboardingGuard/index.tsx` | +2/-1 | LOW | Tiny. |
| `core/src/libraries/hook/context-manager.ts` | +8/-1 | LOW | Our webhook context-manager; small upstream delta. |

## 3. DB alterations (forward, additive)

5 new alteration scripts 1.39.0→1.40.1 (all additive — indexes / columns / one new table):
- `add-account-center-profile-fields`
- `add-custom-ui-csp-to-sie`
- `add-organization-user-relations-user-id-index`
- `add-organization-role-user-relations-org-user-index`
- `add-application-access-control-schema`

No destructive migration. Standard `database alteration deploy next`.

## 4. New connectors — ENABLE in build, config left to operations

Decision (Xianglin, 2026-05-30): **enable/link the new connectors at build time** so they appear in Console → Connectors. Whether to actually configure credentials and turn one on is an **operations decision**, made later in the Logto admin console — not part of this upgrade.

- New in 1.40: MailJunky (email), SMSBao SMS, Aliyun-SMS-MAS (SMS).
- Our Dockerfile already runs `pnpm cli connector link $ADDITIONAL_CONNECTOR_ARGS -p .`, which links **all** workspace connectors. → No Dockerfile change needed; the 3 new connectors are picked up automatically by the standard build.
- Action in this upgrade: **verify** all 3 appear in Console → Connectors after build (mount-only check, no credentials). Leave unconfigured.
- Relevant for cn flavor: SMSBao / Aliyun-SMS-MAS may be useful for prod-3 in future, but prod-3 does not run Logto (shares prod-1 cross-border), so any enablement is still a single prod-1 console action by ops.

## 5. Operational preflight

### Disk (this/build host)
- **DONE 2026-05-30:** reclaimed **12 GB** — was 88% / 19 GB free, now **79% / 31 GB free**. Cleared 17 GB build cache (0 active) + 2 stale `Created` leftover containers from a past `compose run`. All `nicematrix-logto:*` image tags kept (deploy/rollback ladder, shared layers).
- Build heap already raised to 6 GB in Dockerfile (`NODE_OPTIONS`). Host has 8 GB RAM — OK.

### Prod-1 (`46.224.6.74`, deploy target) — do NOT touch until prod stage
- Disk: **67% / 25 GB free** — ample for one new 1.15 GB image.
- Compose lives at **`/var/www/nicematrix-id/deploy/docker-compose.yml`** (working dir `/var/www/nicematrix-id/deploy`).
- Carries ~3.9 GB stale build cache + many backup image tags; cleanup there is a **separate, gated** action (prod = high risk), not bundled into this upgrade.
- prod-3 (cn) runs **no Logto** — zero action there.

## 6. Execution stages (gated)

### Stage 0 — Safety (no deploy)
- Branch `upgrade/logto-1.40`.
- `docker tag nicematrix-logto:latest nicematrix-logto:pre-1.40-backup` (staging) and same on prod-1 at its stage.
- Backup staging DB: `docker exec nicematrix-id-postgres pg_dumpall -U postgres > /root/backups/logto_staging_pre_v1.40.1_<ts>.sql`.
- Reclaim disk (cache + stale tags).

### Stage 1 — Bump submodule
- `cd logto-upstream && git fetch --tags && git checkout v1.40.1` → commit `chore: bump logto-upstream to v1.40.1`.
- Regenerate `OVERRIDE_DRIFT_AUTO.txt` (the 16-file list) into this folder.

### Stage 2 — LOW-risk (36 unchanged + 7 LOW from §2)
- Reapply / confirm path exists; SCSS + tiny-delta merges. Commit.

### Stage 3 — MED-risk core + console + social
- `core/routes/account/index.ts` (rebase 2-line mount), `core/routes/sign-in-experience/index.ts` (rebase hideLogtoBranding OSS allow), `console/consts/external-links.ts`, `SocialSection`, `SocialFlow`, `context-manager.ts`. Commit.

### Stage 4 — HIGH-risk account center
- `App.tsx`, `Profile/index.tsx`, `SocialCallback/index.tsx`. Preserve: SocialCallback early-return + connectorId-from-path fallback; our 6 ProfileSection editors on the Profile route. Commit.

### Stage 5 — Build + verify image
- Reclaim disk first. `cd deploy && docker compose build`. Tag `v1.40.1`. Confirm `core/package.json` = 1.40.0 / core-kit 2.10.0 inside image.

### Stage 6 — Staging deploy + smoke
- Recreate staging logto, run `database alteration deploy next`, health 200.
- Smoke: console login + nav, account-center Security/Profile, social bind/unbind (QQ/Apple/Google/WeChat), email/phone sign-in, **token-exchange (App login id_token/refresh_token)**, native-caps WeChat takeover.
- **STOP — explicit Xianglin approval before prod.**

### Stage 7 — Prod-1 deploy
- Fresh prod DB backup in-session. Retag old image as `pre-1.40-backup`. Build/load image on prod-1, `compose up -d`, run alteration, smoke. (prod-3 cn does NOT run Logto — no action there.)

### Stage 8 — Docs + memory
- Update `docs/patches.md`, `docs/upgrade.md`, `MEMORY.md` Latest-Version line, changelog. Merge branch.

## 7. Rollback
- Image: `docker tag nicematrix-logto:pre-1.40-backup nicematrix-logto:latest && docker compose up -d --force-recreate logto`.
- DB: alterations are additive/forward-only; rollback = restore the pre-upgrade `pg_dumpall` taken in the same session. Coordinate before dropping DB.

## 8. Verification / smoke checklist (run after staging AND prod deploy)

Reuse the proven 1.39 checklist (`docs/upgrade-1.39/VERIFICATION.md`) verbatim, PLUS these 1.40-specific items:
- Image reports `core` = 1.40.0 and `@logto/core-kit` = **2.10.0** (proves we got 1.40.1, not broken 1.40.0).
- `database alteration list` shows all 5 new 1.40 alterations consumed.
- Console → Connectors lists **MailJunky, SMSBao, Aliyun-SMS-MAS** (mount-only, unconfigured).
- Console audit-logs page renders with the new time-range picker (no JS error).
- **Regression-critical (our overrides):** App login token-exchange returns id_token + refresh_token; WeChat native takeover (native_caps passthrough); username-with-dot; mgmt-API resource indicators show `id.nicematrix.com/...` not `*.logto.app`; webhook PostSignIn payload carries `deviceRef`+`appSlug`; backend `/health` + M2M token still valid.
- Account Center: Security shows our DeletionSection (not upstream external-link DeleteAccountSection); Profile route shows our AvatarEditor + 6 field editors.

## 9. Research sources (for traceability)
- Upstream release notes: `@logto/core@1.40.0` (features) + `@logto/core@1.40.1` (core-kit 2.9.0→2.10.0 fix), fetched 2026-05-30.
- Drift computed locally: 77 override files diffed `git d9f0db78b (1.39.0)` → `git 3308305440 (1.40.1)`. Buckets: 24 ours-new / 36 unchanged / 16 changed / 0 removed.
- 5 new DB alterations enumerated from `packages/schemas/alterations/` diff.
- prod-1 runtime facts via SSH `46.224.6.74` (disk, compose path, image ladder).

## 10. State pointer
**CURRENT_STAGE:** analysis complete + local disk reclaimed. Awaiting approval to schedule the upgrade (Stage 0+).
**NEXT_ACTION:** on approval — create branch `upgrade/logto-1.40`, backup staging DB, `git checkout v1.40.1` in submodule, begin merges.
**NOTE:** submodule still pinned at 1.39.0; only tags fetched. No source/runtime changed by this analysis.
