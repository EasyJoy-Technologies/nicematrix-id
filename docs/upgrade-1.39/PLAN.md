# Logto 1.38.0 → 1.39.0 Upgrade Plan

**Owner:** nicematrix-system agent
**Started:** 2026-04-29
**Target image tag:** `nicematrix-logto:v1.39.0`
**Backup image tag (current prod):** `nicematrix-logto:pre-1.39-backup`

---

## Decisions confirmed by Xianglin (2026-04-29)

1. **Profile architecture:** migrate our ProfileSection (fields + avatar editor) from inside Security page to upstream's standalone `/account/profile` route.
2. **SocialSection:** try replacing our override with upstream 1.39 native version. Fall back to our override only if staging test reveals regressions.
3. **Deploy path:** staging (this host, `id-staging.nicematrix.com`) → user approval → production (`46.224.6.74`, `id.nicematrix.com`). Each stage requires explicit user approval to proceed.
4. **WhatsApp connector:** ENABLE in 1.39.

---

## Critical context

### Current overrides (53 files in 7 packages)
- `account` — App.tsx, Security/index, ProfileSection (10 files), SocialSection, DeletionSection, SocialFlow, SocialCallback, PasskeyBinding, i18n bundles, profile/deletion APIs, vite.config, PageHeader styles
- `core` — sign-in-experience routes, interaction hooks, experience hooks, hook lib (context-manager, index), account/avatar.ts (NEW), account/deletion-request.ts (NEW), account/index.ts (mount), post-logout html
- `schemas` — oidc.ts, management-api.ts, hook.ts
- `console` — index.html, App.tsx, tenants.ts, external-links.ts, ConnectorDetails, logo.svg, favicon.svg, use-api.ts, use-image-mime-types.ts, AppLoading scss, Topbar scss
- `experience` — MfaFactorList, SocialSignInList/use-social.ts, SocialSignInWebCallback/use-social-sign-in-listener.ts, social-redirect-override.ts, use-start-identifier-passkey-sign-in-processing.ts, nicematrix-logo.svg, LogtoSignature, SwitchMfaFactorsLink
- `toolkit` — regex.ts (username allows dot)

### Upstream 1.38.0 → 1.39.0 changes affecting our overrides
- **HIGH:** Account Center major refactor (Security split into 6 sections, new Profile route, sidebar)
- **HIGH:** `core/src/routes/account/index.ts` — 2 commits (identifier deletion guard, 2FA toggle) — affects our 1-line mount
- **HIGH:** `core/src/routes/sign-in-experience/index.ts` — 1 commit (sign-up profile fields config) — affects our hideLogtoBranding OSS allow
- **MEDIUM:** `experience/src/containers/SocialSignInList/use-social.ts` — in-app browser localStorage fallback
- **MEDIUM:** `experience/src/pages/SocialSignInWebCallback/use-social-sign-in-listener.ts` — same fallback
- **MEDIUM:** `console/src/consts/external-links.ts` — 2 commits (OSS upsell additions)
- **MEDIUM:** `account/src/pages/Security/index.tsx` — 3 commits
- **MEDIUM:** `account/src/App.tsx` — 8 commits
- **LOW:** Other 18 override files unchanged in 1.39 (verified)

---

## Execution stages

### Stage 0 — Preparation & safety (no-deploy)
- [x] **0.1** Read this PLAN.md before any action
- [ ] **0.2** Tag current prod image: `docker tag nicematrix-logto:latest nicematrix-logto:pre-1.39-backup`
- [ ] **0.3** Backup staging DB: `docker exec nicematrix-id-postgres pg_dumpall -U postgres > /root/backups/logto_staging_pre_v1.39.0_$(date +%Y%m%d_%H%M).sql`
- [ ] **0.4** (Production stage only) Backup prod DB on remote `46.224.6.74` — DEFER
- [ ] **0.5** Create branch `upgrade/logto-1.39` in nicematrix-id repo
- [ ] **0.6** Verify upstream tag fetched: `cd logto-upstream && git tag --list 'v1.39.0'`

### Stage 1 — Bump submodule to v1.39.0
- [ ] **1.1** `cd logto-upstream && git fetch --tags && git checkout v1.39.0`
- [ ] **1.2** Verify HEAD: `git log --oneline -1` should show `d9f0db78b release: version packages (#8602)`
- [ ] **1.3** `cd .. && git add logto-upstream && git commit -m "chore: bump logto-upstream to v1.39.0"`
- [ ] **1.4** Self-check: list overrides with content drift vs new upstream → write to `OVERRIDE_DIFF.md`

### Stage 2 — LOW-risk overrides (verify pass-through)
For each unchanged-upstream override, just re-apply (no edit) and confirm path still exists in upstream.
- [ ] **2.1** Verify and reapply 18 LOW-risk files (script-driven; results to `STAGE2_VERIFY.md`)
- [ ] **2.2** Commit: `chore(overrides): verify low-risk overrides aligned with v1.39.0`

### Stage 3 — MEDIUM-risk three-way merges
- [ ] **3.1** `console/src/consts/external-links.ts`: rebase our contactEmail change on upstream 1.39 base; preserve OSS upsell links
- [ ] **3.2** `core/src/routes/account/index.ts`: rebase our `koaGuard avatar mount` line on upstream 1.39 base
- [ ] **3.3** `core/src/routes/sign-in-experience/index.ts`: rebase our hideLogtoBranding OSS allow on upstream 1.39 base
- [ ] **3.4** `experience/src/containers/SocialSignInList/use-social.ts`: integrate upstream localStorage fallback + preserve our QQ ICP redirect_uri override
- [ ] **3.5** `experience/src/pages/SocialSignInWebCallback/use-social-sign-in-listener.ts`: same as 3.4
- [ ] **3.6** Commit: `feat(overrides): three-way merge medium-risk overrides on v1.39.0`

### Stage 4 — HIGH-risk Account Center refactor
- [ ] **4.1** Replace `account/src/App.tsx` override with upstream 1.39 base AS-IS (delete override). Verify Profile + Security routes work upstream-style.
- [ ] **4.2** Delete our `Security/index.tsx` override; use upstream 6-section version BUT swap `DeleteAccountSection` → our `DeletionSection`
  - Approach: keep upstream `DeleteAccountSection` AS-IS for users who only have external delete URL, BUT we set `accountCenterSettings.deleteAccountUrl` to navigate within app to our `/account/delete` route. Reconfirm.
  - Alternative: keep our Security/index.tsx override that imports our DeletionSection in place of upstream's DeleteAccountSection.
  - **Decision: Alternative (override Security/index.tsx)** — minimum delta, preserves our self-service deletion flow.
- [ ] **4.3** Try upstream's `Security/SocialSection`: delete our override, verify QQ/Apple/Google bind+unbind works on staging
  - If broken: restore our SocialSection override
- [ ] **4.4** Migrate ProfileSection from Security → standalone Profile page:
  - Override `account/src/pages/Profile/index.tsx`: render our existing 6 field editors + AvatarEditor (move from Security/ProfileSection)
  - Move `Security/ProfileSection/*` files to `Profile/components/*` under override
  - Remove `Security/ProfileSection/*` overrides
- [ ] **4.5** Verify `i18n/profile-phrases.ts` still needed after upstream 1.39 i18n alignment; remove if redundant
- [ ] **4.6** Commit: `refactor(account-center): migrate to v1.39.0 Profile/Security architecture`

### Stage 5 — Verify SocialCallback override still required
- [ ] **5.1** Diff our `account/src/pages/SocialCallback/index.tsx` vs upstream 1.39 (file unchanged in 1.39)
- [ ] **5.2** Confirm our `extractConnectorIdFromPath()` fallback + `isLoadingExperience` guard still apply cleanly
- [ ] **5.3** Keep override unchanged

### Stage 6 — Build image + WhatsApp connector
- [ ] **6.1** Verify Dockerfile compatible with v1.39.0 build steps
- [ ] **6.2** Build: `cd /root/projects/nicematrix-id/deploy && docker compose build` (uses logto-custom/Dockerfile)
- [ ] **6.3** Tag: `docker tag <built> nicematrix-logto:v1.39.0`
- [ ] **6.4** Investigate WhatsApp connector: locate package, verify build picked it up via `pnpm cli connector link`
- [ ] **6.5** Commit any Dockerfile/connector tweaks: `feat(connector): enable WhatsApp via Meta Cloud API`

### Stage 7 — Staging deploy + smoke test
- [ ] **7.1** On staging (this host): `docker compose -f deploy/docker-compose.yml down && up -d --no-deps logto`
- [ ] **7.2** Run DB alteration: `docker compose run --rm --entrypoint="" logto node /etc/logto/packages/cli/bin/logto.js database alteration deploy next`
- [ ] **7.3** Health check: container healthy + `/oidc/.well-known/openid-configuration` 200
- [ ] **7.4** Smoke test (auto-script): see VERIFICATION.md
- [ ] **7.5** **STOP — wait for Xianglin approval to proceed to prod**

### Stage 8 — Production deploy
- [ ] **8.1** Backup prod DB on `46.224.6.74`: `pg_dumpall > /root/backups/logto_prod_pre_v1.39.0_$(date +%Y%m%d_%H%M).sql`
- [ ] **8.2** Push image to remote (or rebuild on remote — TBD based on remote build availability)
- [ ] **8.3** SSH `46.224.6.74`, retag old prod image as backup
- [ ] **8.4** `docker compose pull/up -d`
- [ ] **8.5** Run DB alteration on prod
- [ ] **8.6** Smoke test prod
- [ ] **8.7** Update MEMORY.md, deployment.md, patches.md

### Stage 9 — Cleanup & report
- [ ] **9.1** Update `docs/patches.md`, `docs/upgrade.md`, `docs/deployment.md`
- [ ] **9.2** Update `MEMORY.md`: bump Logto version + new override list
- [ ] **9.3** Push branch + open PR (or merge if direct)
- [ ] **9.4** Report to Xianglin with summary table

---

## Rollback procedure (any stage)

### Image rollback
```
ssh root@46.224.6.74
cd /root/nicematrix-id   # or wherever compose lives
docker tag nicematrix-logto:pre-1.39-backup nicematrix-logto:latest
docker compose up -d --force-recreate logto
```

### DB rollback (only if alteration was applied)
```
docker exec -i nicematrix-id-postgres psql -U postgres < /root/backups/logto_<env>_pre_v1.39.0_*.sql
# May require dropping the upgraded DB first; coordinate with user
```

---

## State machine — current pointer

> Update this line at the START and END of every active stage so a fresh session can resume.

**CURRENT_STAGE:** 0 (preparation, ready to execute 0.2)
**LAST_COMPLETED:** 0.1 (PLAN.md written)
**NEXT_ACTION:** Execute 0.2 — tag current prod image as backup

---

## Safety rails (non-negotiable)

- Every stage commit references this plan + stage number in commit message.
- No production touches until staging passes full smoke test AND Xianglin approves.
- Any unexpected upstream behavior change → STOP, document, ask user.
- DB alteration on prod requires fresh prod DB backup taken in same session.
- Override deletion always preceded by 3-way diff record in `OVERRIDE_DIFF.md`.
