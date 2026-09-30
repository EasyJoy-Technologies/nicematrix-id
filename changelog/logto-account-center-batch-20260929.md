# Account-center batch (2026-09-29) — one Logto deploy

Source: NiceNote `nicenote/docs/auth/account-center-code-review-2026-09-27.md` §10 + hand-off.
Plan: nicematrix-backend `docs/_plans/2026-09-29_account-center-batch.md`. Approved: Xianglin 2026-09-29.
Ships together with `c76ee72` (deletion `executing` state + `/deletion/verify`).

## Changes (all in `logto-custom/overrides/`, upstream untouched)

| Item | Files | Behaviour |
|---|---|---|
| Error phrases | `phrases/src/locales/{en,zh-cn,zh-hk,zh-tw}/errors/user.ts` | `user.deletion_request_*` (4) + `user.social_identity_mismatch` get real text instead of the raw code. Other locales fall back to en. |
| Backup-code replace | `core/routes/account/backup-codes-replace.ts` (new), `routes/account/index.ts` | `POST /api/my-account/mfa-verifications/backup-codes/replace` `{codes}` → 204: one write drops all old codes and adds new ones. Same gates as upstream add-backup-codes; never writes `mfa.enabled`. |
| TOTP `otpauthUri` | `core/libraries/totp-key-uri.ts` (new), `routes/account/mfa-verifications.ts`, `routes/experience/.../totp-verification.ts` | `totp-secret/generate` returns `{secret, otpauthUri, secretQrCode(PNG)}`; sign-in flow and Account API share one builder. Additive. |
| Social step-up | `core/libraries/social-step-up.ts`, `core/routes/account/social-step-up.ts` (new), `core/middleware/koa-auth/koa-oidc-auth.ts`, `routes/admin-user/verification-records.ts` | `POST /api/my-account/verifications/social` + `/verify`: user-bound Social record, must match the linked identity (else 422 `user.social_identity_mismatch`). Re-checked at use time in both the Account API auth middleware and the admin assert route; upstream-minted Social records never count. |
| First-password gate | `core/routes/account/first-password-gate.ts` (new), `routes/account/index.ts` | `NICEMATRIX_FIRST_PASSWORD_STEP_UP=on` makes the first password also require a verified record. **Default off** (enable after NiceNote switches to social step-up; restart only). |
| Apple code capture | `core/libraries/apple-authorization-capture.ts` (new), `core/libraries/social.ts` | After an Apple callback is verified, `(sub, aud, code)` goes to `nicematrix_apple_authorization_codes`; Backend (prod-1 `apple-siwa/`) exchanges it for a revocable refresh_token. Best-effort: failures are logged, sign-in unaffected. Apple connector only. |

## Schema
- `sql/20260929_apple_authorization_codes.sql` (+ `.down.sql`): the hand-off table + column grants
  (`users.updated_at`, `users.password_updated_at`) for `nicematrix_backend_maintenance`. Idempotent,
  additive. Apply **before** the image (plus `20260929_user_deletion_executing.sql` from `c76ee72`).

**RLS (fixed 2026-09-30 after the first staging attempt)**: Logto refuses to start unless every public
table has row-level security enabled (`core/src/env-set/preconditions.ts`). The first version of the
migration created the table without it → the new image AND the rolled-back image crash-looped on staging
(~5 min outage, restored by dropping the empty table). The migration now runs
`ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no policy: the Logto owner and `nicematrix_backend_maintenance`
both have BYPASSRLS on staging and prod-1; other roles are denied). `scripts/check.sh` now fails on any
`CREATE TABLE` in `sql/` without it. The image is unaffected (SQL is not baked in).

## Deploy order / rollback
Migrations → Backend → Logto image. Rollback: image + Backend first, `.down.sql` last.

## Tests
`backup-codes-replace.test.ts`, `social-step-up.test.ts`, `koa-oidc-auth.social-step-up.test.ts`,
`nicematrix-account-extras.test.ts` (totp-key-uri, first-password gate, Apple capture).

## Deployed (2026-09-30)
- staging `id-staging` + prod-1 `id.nicematrix.com` (= both regions): image
  `nicematrix-logto:release-71a7b5cbb5c300d547fa0a5449654f1d5eb3abfc-20260930-061111` (bundle `main-A3I7YT4S.js`,
  RootFS layers identical on both hosts). prod-1 rollback tag `nicematrix-logto:rollback-prod-1-20260930-160253`.
- Schema applied on staging + prod-1 (x2, idempotent); only `systems` / `service_logs` lack RLS.
- Verified: discovery 200 / status 204 / JWKS 200, server_error 0, new routes 401 (control 404), `/account/deletion/verify` 200,
  token endpoint serving after the switch. `NICEMATRIX_FIRST_PASSWORD_STEP_UP` not set (off).
