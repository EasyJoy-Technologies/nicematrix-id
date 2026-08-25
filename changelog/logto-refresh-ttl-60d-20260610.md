# Logto default refresh-token TTL 14 → 60 days (2026-06-10)

Goal (Xianglin): reduce client "timeout logout" — raise login validity for all
business client apps to 60 days.

## What changed
- `nicematrix-id` `logto-custom/overrides/packages/schemas/src/consts/oidc.ts`:
  `customClientMetadataDefault.refreshTokenTtlInDays` **14 → 60** (single constant;
  verified only override copy). Commit `d4fbfac` on `main` (pushed).
- Image rebuilt on this host: `nicematrix-logto:rt60-20260610`
  (image config sha `c5d5b71b428a`, manifest `eda672bc69ca`, 1.84GB local /
  1.14GB on prod-1, build rc=0 ~9min). Compiled `schemas/lib/consts/oidc.js`
  confirmed `refreshTokenTtlInDays: 60` in-image on BOTH staging and prod-1.

## Effective token lifetimes after change
- Access token 1h (unchanged), id_token 1h (unchanged), rotate=true (unchanged).
- **Refresh token: 12 Native client apps now 60 days** (were inheriting 14).
  They carry no explicit `refreshTokenTtlInDays` → inherit the compiled default.
- Grant absolute ceiling still 180d; session 14d (unchanged).

## Scope guardrails (why consoles are untouched)
- Consoles with EXPLICIT `refreshTokenTtlInDays:14` are unaffected by a default
  change: NiceMatrix Admin, Email System, OmniFire, bbs.9696.me.
- Built-in `admin-console` had NO explicit TTL → would have inherited 60. Pinned
  back to **14** via DB JSONB merge (preserving `rotateRefreshToken:false`) on
  EACH env (staging + prod-1). This keeps the change strictly the 12 client apps.
- M2M apps don't use refresh tokens — N/A.

## Key traps confirmed (upstream source)
- PATCH `/applications` replaces `customClientMetadata` **wholesale** (JSONB), and
  backend `syncAppToLogto()` rewrites it to `{allowTokenExchange:true}` on any
  admin App edit → a per-app TTL PATCH would (a) wipe allowTokenExchange (break
  native social login) and (b) silently revert to default on next sync. Hence the
  compiled-default approach (Method A): never written by sync, never reverts.
- Native (public, non-web) clients: `defaults.refreshTokenTtl` returns undefined →
  falls through to `refreshTokenTtlInDays * oneDay` = the changed default. Verified.

## Deploy (staging gate → prod-1)
- **Staging** (`id-staging.nicematrix.com`, this host): tag→`:latest`→
  `docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d
  --no-deps --no-build --force-recreate logto`. Healthy 15s. NO DB alteration.
- **Prod-1** (`46.224.6.74`, `id.nicematrix.com`, after GO): rollback tag
  `nicematrix-logto:pre-rt60-backup-20260610_0059` (sha `389b943bc89d`) + DB dump
  `/root/backups/logto_prod_pre_rt60_20260610_0059.sql` (100MB/195k lines) →
  `docker save | gzip | ssh docker load` (~54s) → promote `:latest` →
  force-recreate. Healthy ~5s, clean boot.
- **Prod-3 (cn)**: runs NO Logto (cross-border to prod-1) → zero action; verified
  `apiv3.ej-mobile.cn/v1/meta` 200 region:cn v1.2.354.

## Empirical verification (real native login path, both envs)
subject-token → token-exchange grant w/ `scope=...offline_access` on a Native app
→ read issued RefreshToken `expires_at` from `oidc_model_instances`:
- Staging (易录音, temp redirect/allowTokenExchange added+reverted): **60.00d**.
- Prod-1 (悬浮球录屏锁屏, already had redirect+allowTokenExchange): **60.00d**,
  access expires_in=3600, id_token+refresh_token present (overrides intact).
- Both test RT artifacts deleted; staging temp app edits fully reverted.
- prod-1 smoke: issuer ok, token-exchange + refresh_token grants advertised,
  console 302, jwks 200, api.nicematrix.com/health 200.

## Rollback
`docker tag nicematrix-logto:pre-rt60-backup-<TS> nicematrix-logto:latest &&
docker compose -p nicematrix-id --env-file /etc/nicematrix/id.env up -d
--no-deps --no-build --force-recreate logto`. DB unchanged (additive constant
only) — admin-console pin can be left or removed via JSONB `- 'refreshTokenTtlInDays'`.

## Backups / artifacts
- Staging rollback image: `nicematrix-logto:pre-rt60-backup-20260610_0037` (`7f1b7facaabc`).
- Prod-1 rollback image: `nicematrix-logto:pre-rt60-backup-20260610_0059` (`389b943bc89d`).
- Prod-1 DB dump: `/root/backups/logto_prod_pre_rt60_20260610_0059.sql`.
- New image tag (both hosts): `nicematrix-logto:rt60-20260610`.

## Note on residual "timeout logout"
The 60d default fixes the *inactivity* case. The other common premature-logout
cause is client-side refresh handling (no single-flight → rotation reuse-detection
revokes the whole grant; or AT expiry with no silent refresh). If reports persist,
audit client refresh: single-flight + persist new RT + drop old. (rotation stays ON.)
