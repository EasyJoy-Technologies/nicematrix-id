# 1.40 Upgrade — Live State

> Source of truth for resuming work after session interruption.

## Pointer
- **CURRENT_STAGE:** 6 (Staging deploy + smoke — DONE; awaiting user approval for Stage 7 prod deploy)
- **LAST_COMPLETED:** Stage 6 — staging on `id-staging.nicematrix.com` running v1.40.1, all smoke checks pass
- **NEXT_ACTION:** Wait for Xianglin GO, then Stage 7 (prod-1 `46.224.6.74` / `id.nicematrix.com`)
- **BLOCKER:** Awaiting user GO/NO-GO for prod
- **LAST_UPDATED:** 2026-05-30 ~16:20 MDT

## Commits in branch `upgrade/logto-1.40`
- b027ffe chore: bump logto-upstream to v1.40.1 (core-kit 2.10.0)
- 3b81146 feat(overrides): rebase all 16 changed overrides onto logto v1.40.1

## Build artifacts
- Image: `nicematrix-logto:latest` AND `nicematrix-logto:v1.40.1` (id `922111bac3c5`, 1.84GB)
- Backup retained: `nicematrix-logto:pre-1.40-backup` (`7b12a978b35c`, = old 1.39.0 staging image)
- In-image verified: core `1.40.1`, `@logto/core-kit` `2.10.0` (proves 1.40.1 not broken 1.40.0).
- 5 new alterations present in image; 3 new connectors mounted (aliyun-sms-mas, mailjunky, smsbao-sms).
- Bundled overrides confirmed: token-exchange (offline_access), avatar+deletion routes, 5 NiceMatrix markers, username-dot regex, native_caps in oidc consts.

## DB (staging)
- Backup: `/root/backups/logto_staging_pre_v1.40.1_20260530_1550.sql` (pg_dumpall, 11M)
- alterationState advanced `1776502301` → `1779421396` (5 alterations deployed, all up() succeeded)
- New tables: application_access_control_{user,user_role,organization,org_role}_relations
- New columns: sign_in_experiences.custom_ui_csp, account_centers.profile_fields

## Stage 6 staging smoke (all PASS)
| Check | Result |
|---|---|
| Container healthy (core 1.40.1) | ✅ Up (healthy), clean boot logs |
| 5 × 1.40 alterations deployed | ✅ state=1779421396, 4 tables + 2 cols verified |
| OIDC discovery / issuer | ✅ issuer=id-staging.nicematrix.com/oidc, 8 endpoints |
| JWKS | ✅ 200 |
| Account Center page | ✅ 200, SPA `<title>Account Center</title>` |
| Account bundle merged-Home strings | ✅ "Account Center"/"Security"/"Delete Account" in built JS |
| POST /api/my-account/avatar | ✅ 401 (route exists) |
| POST /api/my-account/deletion-request | ✅ 401 (route exists) |
| Console page | ✅ 200 |
| mgmt-API resource indicators | ✅ id.nicematrix.com/{admin/api,admin/me,default/api}; NO logto.app |
| native_caps passthrough (mobile UA) | ✅ /sign-in?...&native_caps=wechat,alipay,qq&native_scheme=...&app_slug=... |
| PC UA stays clean | ✅ /sign-in?app_id=... (no native param leak) |
| token-exchange grant advertised | ✅ in grant_types_supported |
| username-with-dot regex | ✅ /^[A-Z_a-z](?:[\w.]*\w)?$/ |
| webhook 9aiz0tmuqb834vpu1nkcx | ✅ enabled (NiceMatrix Login Control) |
| M2M apps / connectors preserved | ✅ 4 M2M, 10 connectors |
| branding (logo + color) | ✅ NiceMatrix-170x64-v2.svg, #0013FF |
| backend api.nicematrix.com/health | ✅ 200 (M2M to Logto still valid) |
| 3 new connectors mounted | ✅ aliyun-sms-mas, mailjunky, smsbao-sms |

## Stage 7 prod-1 deploy plan (after approval)
1. SSH `46.224.6.74`; fresh prod DB backup (pg_dumpall) in-session.
2. Tag current prod image `nicematrix-logto:latest` → `:pre-1.40-backup` on prod-1.
3. Transfer image: `docker save nicematrix-logto:v1.40.1 | ssh ... docker load` (or rebuild on prod).
4. `cd /var/www/nicematrix-id/deploy && docker compose --env-file /etc/nicematrix/id.env up -d --no-deps --force-recreate logto`.
5. It will refuse to boot (undeployed alterations) → run `database alteration deploy next` (5 alterations).
6. `docker compose restart logto`; wait healthy.
7. Full smoke on id.nicematrix.com (reuse checklist above).
8. (prod-3 cn runs no Logto — zero action.)

## Rollback
- Image: `docker tag nicematrix-logto:pre-1.40-backup nicematrix-logto:latest && docker compose up -d --force-recreate logto`.
- DB: alterations additive/forward-only; restore the pre-upgrade pg_dumpall from same session if needed.

## Outstanding decisions
- (none — all clear; pending user GO for Stage 7 prod)
