# 1.39 Upgrade — Verification & Smoke Test Checklist

Run after every staging/prod deploy. Mark each item explicitly.

## Container/runtime
- [ ] `docker ps` shows `nicematrix-logto` running with image tag `nicematrix-logto:v1.39.0`
- [ ] Container health: no restart loop, no startup errors in `docker logs --tail=200 nicematrix-logto`
- [ ] DB alteration completed: `docker compose run --rm logto node packages/cli/bin/logto.js database alteration list` shows `next` consumed

## OIDC / API surface
- [ ] `GET /oidc/.well-known/openid-configuration` → 200, issuer = `https://id-staging.nicematrix.com/oidc` (staging) or `https://id.nicematrix.com/oidc` (prod)
- [ ] JWKS endpoint accessible
- [ ] `GET /api/.well-known/preview` (or admin tenant probe) — 401 (auth required) NOT 404
- [ ] Backend `nicematrix-backend` `/health` still passes (M2M token still valid for resource `https://id.nicematrix.com/admin/api`)

## Account Center
- [ ] `/account` (root) → loads home page
- [ ] `/account/security` → loads, shows: Username, Email/Phone, Password, Social, MFA, **our DeletionSection** (NOT upstream DeleteAccountSection external link)
- [ ] `/account/profile` → loads, shows: AvatarEditor + 6 field editors (familyName, givenName, nickname, birthdate, gender, address.formatted)
- [ ] Sidebar visible on /security and /profile, not on home
- [ ] Avatar upload: select file → uploads to R2 (`assets.nicematrix.com`), persists in `users.avatar`
- [ ] Avatar delete: removes from R2, clears `users.avatar`
- [ ] Profile field save: each editor updates `users.profile.*` correctly
- [ ] Account deletion: create request → 15-day grace, status visible, cancellable
- [ ] Social binding: QQ / Apple / Google add → callback → identity row in `user_identities`
- [ ] Social unbinding: works without leaving user without any sign-in identifier
- [ ] MFA toggle: enable/disable per factor

## Login experience
- [ ] Sign-in page (`/sign-in`) loads with NiceMatrix branding (170x64 svg)
- [ ] Email + verification code login flow
- [ ] Password login flow
- [ ] QQ social login (verify redirect_uri = `id.ej-mobile.cn` for ICP compliance — staging may use different host but prod must)
- [ ] Apple / Google social login
- [ ] Username with `.` accepted (regex override)
- [ ] PostSignIn webhook fires; payload contains `deviceRef` + `appSlug`
- [ ] Backend login control (`max_devices_per_platform`) still enforced via webhook

## Console
- [ ] `/console` admin login works (OSS mode, admin tenant resource)
- [ ] Browser title = `NiceMatrix Console` (not `Logto Console`)
- [ ] AppLoading logo sized correctly (48px height, not full screen)
- [ ] Topbar logo 38px height
- [ ] `hideLogtoBranding` saves without error
- [ ] Sign-in experience page → branding logo upload accepts our MIME types
- [ ] M2M resource indicators visible: `https://id.nicematrix.com/admin/api`, `/admin/me`, `/default/api` (NO `*.logto.app`)

## Backend integration
- [ ] `nicematrix-backend` API → `/health` 200
- [ ] Login flow end-to-end through backend (admin web `m.nicematrix.com`)
- [ ] Webhook `9aiz0tmuqb834vpu1nkcx` deliveries succeed (check Logto Console → Webhooks → Recent activity)

## WhatsApp connector (NEW in 1.39)
- [ ] Connector visible in Console → Connectors
- [ ] Can add WhatsApp connector instance (without configuring real credentials, just verify mount)

## Regression safety
- [ ] Existing user can still sign in (no schema break)
- [ ] Existing M2M token still works
- [ ] Existing social bindings still resolve correctly
