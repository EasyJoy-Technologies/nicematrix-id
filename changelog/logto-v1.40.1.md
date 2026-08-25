# Logto Upgrade 1.39.0 → 1.40.1 (2026-05-30)

NiceMatrix-ID self-compiled Logto upgraded from `1.39.0` to `1.40.1` (core-kit `2.9.0`→`2.10.0`).
Repo: `/root/projects/nicematrix-id`, branch `upgrade/logto-1.40` → merged to `main` (pushed `15db738`).
Upgrade docs: `nicematrix-id/docs/upgrade-1.40/{PLAN,STATE,OVERRIDE_DRIFT_AUTO}`.

## Why 1.40.1 (not 1.40.0)
1.40.0 ships core-kit `2.9.0` = broken dependency graph; 1.40.1 ships `2.10.0` (good). Pinned submodule HEAD `330830544` (#8909), core/package.json = 1.40.1.

## Override drift
24 ours-new (passthrough) · 36 unchanged · 16 changed · 0 removed (independently recomputed, matches PLAN).
Key rebuilds on 1.40.1 base: `account/App.tsx`, `account/SocialCallback`, `core/routes/account/index.ts` (re-mount avatar + deletion routes), `core/routes/sign-in-experience/index.ts` (OSS hideLogtoBranding + Cloud-only quota, keep upstream Custom-UI-CSP).
Deleted dead wrappers: `account/pages/Profile/index.tsx`, `account/pages/Security/index.tsx` (App.tsx redirects /profile + /security → /).
3 files intentionally unchanged: `App.module.scss`, `SocialSection/index.module.scss`, `OssOnboardingGuard/index.tsx`.

## DB alterations (5 new, all additive/forward-only)
- `1.40.0-1776516232-add-account-center-profile-fields` → `account_centers.profile_fields`
- `1.40.0-1778318116-add-custom-ui-csp-to-sie` → `sign_in_experiences.custom_ui_csp`
- `1.40.0-1778500000-add-organization-user-relations-user-id-index`
- `1.40.0-1778500001-add-organization-role-user-relations-org-user-index`
- `1.40.0-1779421396-add-application-access-control-schema` → 4 `application_access_control_*` tables

## Build
- Image `nicematrix-logto:v1.40.1` (= `latest`), id `922111bac3c5` (staging) / `28aa14808e2b` (prod load), ~1.84GB, linux/amd64.
- In-image verified: core 1.40.1, core-kit 2.10.0, 48 connector pkgs (3 new: aliyun-sms-mas, mailjunky, smsbao-sms; existing wechat/alipay/whatsapp/yunpian preserved).
- Dockerfile: node:22-alpine, pnpm ^10, NODE_OPTIONS=--max-old-space-size=6144, dev_features_enabled=true.

## Deploy
**Staging** (this host, `id-staging.nicematrix.com`, 2026-05-30 ~16:20 MDT): build → recreate → 5 alterations deployed (state 1776502301→1779421396) → full smoke PASS.
- Staging DB backup: `/root/backups/logto_staging_pre_v1.40.1_20260530_1550.sql` (11M).
- Staging rollback image: `nicematrix-logto:pre-1.40-backup` (`7b12a978b35c`).

**Prod-1** (`46.224.6.74`, `id.nicematrix.com`, 2026-05-30 ~20:14 MDT, after Xianglin GO):
1. DB backup `/root/backups/logto_prod_pre_v1.40.1_20260530_2012.sql` (pg_dumpall, 86MB).
2. Rollback image tag `nicematrix-logto:pre-1.40-backup-20260530_2012` (= old `b43890eb2f61` = token-exchange-rt-idtoken-20260528).
3. Transfer: `docker save v1.40.1 | gzip | ssh ... docker load` (rc=0).
4. `docker compose --env-file /etc/nicematrix/id.env run ... database alteration deploy next` → 5 alterations up() succeeded.
5. `docker compose --env-file /etc/nicematrix/id.env up -d --no-deps --no-build --force-recreate logto`.
6. Healthy in ~27s, clean boot (core 1.40.1).

> prod-3 (cn) runs NO Logto — zero action (cross-border to prod-1 id.nicematrix.com).

## Prod smoke (all PASS)
root 302 · OIDC issuer + 8 endpoints · JWKS 200 · Console 200 · Account Center 200 (`<title>Account Center</title>`) · avatar + deletion-request 401 (override routes) · token-exchange grant advertised · native_caps/native_scheme/app_slug in oidc consts + buildLoginPromptUrl · username dot-regex `[A-Z_a-z](?:[\w.]*\w)?$` · 9 DB connectors · 3 M2M apps · branding logo + #6139F6 · backend api.nicematrix.com/health 200 · 4 new tables + 2 new columns present.

## Rollback (if needed)
- Image: `docker tag nicematrix-logto:pre-1.40-backup-20260530_2012 nicematrix-logto:latest && docker compose --env-file /etc/nicematrix/id.env up -d --no-build --force-recreate logto`.
- DB: alterations are additive/forward-only; restore the pre-upgrade pg_dumpall from same session only if a hard rollback is required.

## Preserved NiceMatrix overrides (verified live)
token-exchange offline_access (id_token + refresh_token), avatar + deletion-request routes, native_caps/native_scheme/app_slug passthrough (ExtraParamsKey + buildLoginPromptUrl), username-with-dot regex, OSS hideLogtoBranding, QQ ICP SocialCallback origin override.
