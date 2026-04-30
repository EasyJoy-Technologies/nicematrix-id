# 1.39 Upgrade — Live State

> Source of truth for resuming work after session interruption.
> Update this file at start and end of every action.

## Pointer
- **CURRENT_STAGE:** 7 (Staging smoke test — DONE; awaiting user approval for Stage 8 prod deploy)
- **LAST_COMPLETED:** Stage 7 — staging smoke test passes on all 13 checks
- **NEXT_ACTION:** Wait for user approval, then Stage 8 (production deploy to `46.224.6.74`)
- **BLOCKER:** Awaiting user GO/NO-GO for prod
- **LAST_UPDATED:** 2026-04-29 22:00 MDT

## Commits in this branch
- 4d... docs(upgrade): add 1.39 upgrade plan, state, verification, override-diff
- 01ebe1e chore: bump logto-upstream to v1.39.0
- 000bc4c docs(upgrade): generate auto override drift report v1.38->v1.39
- af79224 feat(overrides): three-way merge medium-risk overrides on v1.39.0
- fe6d7fa refactor(account-center): migrate to v1.39.0 Profile/Security architecture

## Decisions log
- 2026-04-29: User confirmed all 4 architectural decisions (see PLAN.md)
- 2026-04-29: User confirmed enabling WhatsApp connector
- 2026-04-29: WhatsApp connector auto-linked via `pnpm cli connector link` in Dockerfile (no extra config needed; all `packages/connectors/connector-*` get symlinked except `connector-logto-*` and `connector-mock-*`)
- 2026-04-29: ProfileSection kept at `Security/ProfileSection/*` path; new `Profile/index.tsx` override imports it. Deferred relocating component files until a future refactor.

## Stage 6 build artifacts
- Image: `nicematrix-logto:v1.39.0` and `nicematrix-logto:latest` (image id `2f12701bec94`)
- Backup retained: `nicematrix-logto:pre-1.39-backup` (`e77563a88535`)
- Image size: 1.85GB (same baseline as previous build)
- Build duration: ~4 min (deps cached miss; pnpm i 25s + pnpm -r build ~4min)
- WhatsApp connector linked at: `/etc/logto/packages/core/connectors/@logto-connector-whatsapp` (verified)

## Stage 7 staging smoke test results (all PASS)
| Check | Result |
|---|---|
| Container healthy | ✅ Up X min (healthy) |
| 1.39 alterations deployed | ✅ 3/3 (`add-delete-account-url`, `add-account-center-custom-css`, `add-sign-up-profile-fields`) |
| Issuer | ✅ `https://id-staging.nicematrix.com/oidc` |
| OIDC discovery | ✅ 8 endpoints exposed |
| Logto core version | ✅ `1.39.0` per package.json |
| Account Center page | ✅ HTTP 200 |
| `POST /api/my-account/avatar` | ✅ 401 (route exists, requires auth) |
| `POST /api/my-account/deletion-request` | ✅ 401 |
| WhatsApp connector linked | ✅ `@logto-connector-whatsapp` symlink present |
| Webhook (login control, ID `9aiz0tmuqb834vpu1nkcx`) | ✅ enabled |
| Admin tenant M2M apps | ✅ 7 apps preserved |
| Sign-in experience branding | ✅ NiceMatrix logo + theme color preserved |
| ProfileSection i18n keys | ✅ in dist bundle (`profile_section.address`, …, 10 keys) |
| DeletionSection i18n keys | ✅ in dist bundle (`account_center.deletion.*`, 15 keys) |

## Verified facts (don't re-discover)
- Logto v1.39.0 release tag: commit `d9f0db78b release: version packages (#8602)`
- Current prod image (running on `46.224.6.74`): `nicematrix-logto:latest` ≈ v1.38.0 base + our overrides
- Staging host: this server `debian-8gb-hel1-1` / `135.181.147.90` / `id-staging.nicematrix.com`
- Prod host: `46.224.6.74` / `id.nicematrix.com`
- Backend M2M resource indicator: `https://id.nicematrix.com/admin/api` — MUST NOT change during upgrade
- Logto webhook ID: `9aiz0tmuqb834vpu1nkcx` — relies on `deviceRef` + `appSlug` ExtraParams (our override in `schemas/oidc.ts`)

## Pending alterations on prod DB
3 1.39 alterations need to be deployed on prod DB **after** image swap:
1. `1.39.0-1774752400-add-delete-account-url.js`
2. `1.39.0-1774770686-add-account-center-custom-css.js`
3. `1.39.0-1776502301-add-sign-up-profile-fields.js`

All three are additive (new columns/tables); zero-risk for existing data.

## Stage 8 prod deploy plan (after user approval)
1. SSH to `46.224.6.74`
2. Backup prod DB: `pg_dump -F c logto -h 127.0.0.1 -p 15433 -U logto > /root/backups/logto_prod_pre_v1.39.0_<ts>.dump`
3. Backup current prod image: `docker tag nicematrix-logto:latest nicematrix-logto:pre-1.39-prod-backup`
4. Transfer image (option A: ssh + docker save/load; option B: rebuild on prod from same git ref)
5. `cd <prod compose dir> && docker compose --env-file /etc/nicematrix/id.env up -d`
6. Wait for "Undeployed alterations" log → run `npx logto db alt deploy 1.39.0` inside container
7. `docker restart nicematrix-logto`
8. Verify: `curl -sI https://id.nicematrix.com/oidc/.well-known/openid-configuration | head`
9. Smoke test M2M token exchange from backend
10. Verify NiceMatrix Backend can call Logto admin API
11. Verify Account Center, social bind, avatar upload, deletion request all work end-to-end

## Outstanding decisions
- (none — all clear; pending user GO for Stage 8)
