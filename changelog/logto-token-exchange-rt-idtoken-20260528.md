# Logto override: token-exchange id_token + refresh_token - 2026-05-28

> Image: `nicematrix-logto:token-exchange-rt-idtoken-20260528` (prod-1 sha `b43890eb2f61`)
> Backup tag (prod-1): `nicematrix-logto:pre-token-exchange-rt-idtoken-20260528` (sha `8892ac362d24`, previous `:native-caps-extraparam-20260527`)
> Commit: `c6c6d1a` (`logto-custom: extend token-exchange grant with refresh_token + id_token`)

## Problem

Native social login Phase B returns a Logto subject token to the app, then the app exchanges it through RFC 8693 token-exchange. Upstream Logto only returned `access_token`, so mobile clients had no `id_token` and no `refresh_token`. That forced a full native-social login redo after access-token expiry.

## Fix

Override `packages/core/src/oidc/grants/token-exchange/index.ts` with a near-upstream copy plus marked NiceMatrix delta blocks:

- keep old response unchanged when neither `openid` nor `offline_access` is requested
- issue `id_token` when scope includes `openid`
- issue `refresh_token` when scope includes `offline_access` and the client allows `refresh_token`
- save the refresh token under the same `grantId` as the token-exchange access token so the normal refresh grant can rotate it
- preserve DPoP / mTLS binding fields for public clients

## Deployment

Built locally from `/root/projects/nicematrix-id`, saved to `/tmp/logto-token-exchange-rt-idtoken.tar.gz` (~324 MB), copied to prod-1, loaded and tagged as `nicematrix-logto:latest`, then recreated only the Logto container with compose. Container became healthy in 8 seconds.

## Verification

Prod-1 matrix used real Native app `ypui8tmpd5f45948tizin` (`ej.easyjoy.easylocker.cn://oauth/callback`) and existing Logto user `03s20o6dae44`.

| Check | Result |
|---|---|
| no scope | 200, only `access_token` / `expires_in` / `scope` / `token_type` |
| `openid` | 200, includes `id_token`, no `refresh_token` |
| `offline_access` | 200, includes `refresh_token`, no `id_token` |
| `openid offline_access profile email` | 200, includes both tokens |
| `id_token` claims | `iss` / `aud` / `sub` / future `exp` / `iat` / `at_hash` all valid |
| refresh grant using TE refresh token | 200, returns rotated `access_token` + `refresh_token` + `id_token` |
| subject token reuse | first exchange 200, second exchange 400 `invalid_grant` |
| public OpenID config | `https://id.nicematrix.com/oidc/.well-known/openid-configuration` HTTP 200 |
| container | `nicematrix-logto:latest` healthy |

Notes:

- The first external Python request hit Cloudflare 1010 because of Python's default client fingerprint; curl and app-style requests are unaffected. Final black-box matrix used local `127.0.0.1:3001` with `Host: id.nicematrix.com`, which selects the same admin tenant and validates signed tokens against public issuer `https://id.nicematrix.com/oidc`.
- A 403 during early testing was caused by omitting `scope=all` from the M2M client-credentials request. Backend production code already sends `scope=all`.

## Rollback

```bash
ssh root@46.224.6.74
docker tag nicematrix-logto:pre-token-exchange-rt-idtoken-20260528 nicematrix-logto:latest
cd /var/www/nicematrix-id/deploy
docker compose --env-file /etc/nicematrix/id.env -p nicematrix-id up -d --force-recreate logto
```
