# Logto TOTP authenticator-app issuer = brand name (2026-06-11)

## Problem (user-reported)
Authenticator apps (Google Authenticator, 1Password, Authy, …) showed the TOTP
account **title** as the domain `id.nicematrix.com`, not a brand name. Other
apps show a friendly name. Ask: show `NiceMatrix ID` instead.

## Root cause
The title an authenticator app shows = the **`issuer`** field of the TOTP
`otpauth://` URI. otplib v12 `authenticator.keyuri(accountName, issuer, secret)`
— arg 2 (`service`) is the issuer. Upstream Logto hard-codes `service` to the
**request hostname** (`ctx.URL.hostname` / frontend `window.location.hostname`)
in **all** TOTP generation paths.

## Fix (commit `be60cd7` in nicematrix-id repo, pushed to origin/main)
Single source of truth + 4 call-site overrides, all `[NiceMatrix]` marked:
- `core/src/constants/mfa-issuer.ts` **(new)** → `export const mfaIssuerName = 'NiceMatrix ID'`
- `core/src/routes/experience/classes/verifications/totp-verification.ts` — hosted **login-flow** MFA binding (the main path; admin console login + any SIE-MFA). Removed now-dead hostname plumbing; `generateNewSecret`'s `ctx` kept as `_ctx` so the caller route needs no override; `generateSecretQrCode()` arg dropped.
- `core/src/routes/interaction/additional.ts` — legacy interaction flow, register + sign-in branches (2 keyuri calls). **WebAuthn `rpId: ctx.URL.hostname` intentionally left as the real domain** (RP ID must be the domain).
- `core/src/routes/admin-user/mfa-verifications.ts` — admin Management API (`POST /users/:id/mfa-verifications`).
- `account/src/pages/TotpBinding/index.tsx` — Account Center self-service. Separate frontend bundle, **cannot import from packages/core**, so it inlines the same `'NiceMatrix ID'` literal with a comment cross-referencing `mfa-issuer.ts`. Keep both in sync.
- `logto-custom/README.md` — added override entry.

## Why safe (zero risk)
The issuer is a **display field only** — NOT part of the TOTP HMAC (secret +
30s time step). So code generation/verification is unaffected for both existing
and new bindings. No protocol / auth / DB / redirect change. Only **newly**
created TOTP bindings show the new title; already-bound authenticator entries
keep whatever issuer they were created with (cosmetic, no action needed).
`@silverhand/ts-config` is `strict` but does NOT set `noUnusedParameters`; Docker
build runs `pnpm -r build` (tsc) only, not eslint. Left zero dead code anyway.

## Build + staging verification (passed)
- Image rebuilt on this host (staging build host): `nicematrix-logto:latest` =
  `57d617865446` (2026-06-11 19:49). Feature tag `totp-issuer-brand-20260611`.
  Full `pnpm -r build` clean — **no `error TS`** (core + account + experience +
  console all built). Verified compiled output: core build references
  `mfaIssuerName` + contains `NiceMatrix ID`; account dist contains `NiceMatrix ID`.
- Staging rollback tag: `nicematrix-logto:staging-backup-20260611-1953` → old `192e350010bf`.
- Container recreated, healthy, clean startup logs, OIDC discovery 200,
  experience bundle `index-CuRXcXRx.js` / account bundle `index-CBrYCCUt.js` (new hashes).
- **Functional test** (admin Management API TOTP path, File 3): created throwaway
  user → `POST /users/:id/mfa-verifications` → decoded returned QR with `zbarimg`:
  `otpauth://totp/NiceMatrix%20ID:...?...&issuer=NiceMatrix%20ID` → **issuer = `NiceMatrix ID` ✅**.
  Throwaway user deleted (204), temp files cleaned.

## Deploy
- Staging (id-staging): ✅ done 2026-06-11. Image `57d617865446`.
- prod-1 (id.nicematrix.com): ✅ done 2026-06-11. Same staging-verified image transferred
  per `deployment-standard.md` §4: `docker save` (md5 `ac2469a8fb40…` matched both ends)
  → scp → load (config id `6b2d29e530d4` = build-log exported config) → content
  re-verified in loaded image (core `mfaIssuerName`+`NiceMatrix ID`, account dist
  `index-CBrYCCUt.js`) → tagged rollback anchor `prod-backup-20260611` (old `9daa66c05bd9`)
  → `compose up -d logto` recreate → healthy, clean logs, public OIDC 200, live
  `/oidc/token` 200. **Functional test on prod**: admin-API TOTP QR decoded →
  `issuer=NiceMatrix ID` ✅. Throwaway user deleted (204), tar/temp cleaned both ends.
- prod-3 (cn): does NOT run Logto (cross-border to prod-1) — nothing to deploy there.

## Rollback
Staging: `docker tag nicematrix-logto:staging-backup-20260611-1953 nicematrix-logto:latest && docker compose --env-file /etc/nicematrix/id.env -f deploy/docker-compose.yml up -d logto`.
Prod: retag `prod-backup-<date>` → latest + recreate (30s, per deployment-standard §5.1).
