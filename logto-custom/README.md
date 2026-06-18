# logto-custom

Custom layer for NiceMatrix.

## Structure

- `Dockerfile` - source-based image build using `logto-upstream/` + overrides
- `overrides/` - source file overrides (keep minimal)
- `branding/` - logo/icon assets used by overrides

## Rule

Do not patch built dist bundles. Customize at source level only.

## Current overrides

### `packages/connectors/connector-oidc/src/` — `identitySource` (sub|oid) (2026-06-18)

**Why**: The Microsoft (Entra) connector was migrated from `azuread` to the standard `oidc` connector on 2026-06-17 (for OneDrive token-vault support — the `azuread` connector has no token storage). The stock `oidc` connector hard-codes the Logto identity id to the `sub` claim. Microsoft `sub` is a **pairwise** identifier — unique per *user AND per OIDC application/client_id* — so it differs from the id the old `azuread` connector stored (Graph `id` = MSA CID = `oid` tail) and would change again on any future app/connector re-creation. Result: every existing Microsoft user was re-orphaned (treated as a new user) after the migration. Microsoft's documented immutable, app-independent, Graph-aligned user key is **`oid`** (tenant-stable; strict global = `oid`+`tid`). This override lets the connector key on `oid` instead of `sub`.

**Patch** (3 files, full-copy of upstream 1.40.1 with marked `[NiceMatrix]` deltas — verified by `diff` to differ from upstream ONLY by these blocks):
- `types.ts` — (1) add `oid: z.string().nullish()` to `idTokenProfileStandardClaimsGuard` so the `oid` claim survives the zod parse into `result.data` (upstream `z.object` strips unknown keys); (2) add `identitySource: z.enum(['sub','oid']).optional().default('sub')` to `oidcConnectorConfigGuard`.
- `index.ts` — single delta block in `parseUserInfoFromIdToken`: `const id = config.identitySource === 'oid' ? oid : sub;` then **throw** `SocialIdTokenInvalid` if the selected claim is absent. **No silent fallback to `sub`** — a fallback would mint a different id than the migrated records and re-orphan the user (the exact bug being fixed). Everything else is verbatim.
- `constant.ts` — add an `identitySource` **Select** form item (default `sub`) so the field is visible/editable in Console and not dropped on connector edit-save.

**Risk surface**: zero for non-Microsoft OIDC. `identitySource` defaults to `sub`, so any oidc connector that does not set it (and every other social connector) behaves byte-identically to upstream. `oid` is set ONLY on the Microsoft connector config. Requires `profile` scope (already in the Microsoft connector scope) for `oid` to be emitted. Unit test: `logto-custom/tests/test-oidc-identity-source.js` (6 cases incl. the no-silent-fallback safety case). Paired with a one-time existing-data normalization (xianglin CID→full-oid zero-pad; jie.hua duplicate sub-binding removed; legacy_cn already oid) and an id-staging real-Microsoft login smoke. Image rebuild required (id-staging → prod-1; cn/prod-3 shares prod-1 Logto cross-border). Detail: nicematrix-system `memory/changelog/`.

### `packages/core/src/routes/admin-user/verification-records.ts` + `index.ts` (2026-06-15)

**Why**: Logto validates a *sensitive-operation verification record* only inside the Account API opaque-token middleware (`core/src/middleware/koa-auth/koa-oidc-auth.ts → getVerificationRecordResultById`) and the experience flows — there is **no Management API route** for a trusted M2M caller to confirm "this record is owned by user X and verified". The NiceMatrix backend needs exactly that so native third-party bind/unbind (`POST/DELETE /v1/me/identities/{wechat|alipay|qq}`) can be gated behind the **same step-up second-factor** that Logto's own web-flow social binding already enforces. Without it those native endpoints had no second-factor, so a stolen (device/IP-unbound) native access token could silently bind an attacker's own social account onto a victim — a backdoor a password change / MFA would not stop. Plan: nicematrix-backend `docs/_plans/2026-06-15_native-bind-step-up-verification.md` (scheme A1).

**Patch**:
- `admin-user/verification-records.ts` (new) — `POST /api/users/:userId/verification-records/assert`, body `{ recordId }`. Decision logic is byte-identical to upstream `getVerificationRecordResultById`: find active record → require `record.userId === :userId` → `verificationRecordDataGuard.safeParse` → `buildVerificationRecord(...).isVerified`. **`204`** when valid+verified+owned; **`422`** (`verification_record.not_found`) when missing / expired / wrong-owner / malformed / unverified (collapsed — no owner/existence oracle); **`400`** (koa-guard) on missing `recordId`. Read-only, zero side effects, returns no PII. Accepts ANY verified record type (password / email-OTP / phone-OTP / social / passkey) so social-only users keep parity with Logto web binding.
- `admin-user/index.ts` (override of upstream wiring) — registers `adminUserVerificationRecordsRoutes` **before** `adminUserBasicsRoutes` so the static `/users/:userId/verification-records/assert` path wins the koa-router match over `/users/:userId` (same belt-and-braces ordering rationale as `by-identity`).

**Risk surface**: pure increment, no existing route touched. Mounted on `managementRouter`, which already enforces M2M auth + `PredefinedScope.All` (koa-auth) — no new auth code. Reuses only upstream-exported primitives (`queries.verificationRecords.findActiveVerificationRecordById`, `verificationRecordDataGuard`, `buildVerificationRecord`); no new query, no schema/DB change. Unit test: `logto-custom/tests/test-verification-records.js` (7 cases). The koa wiring + zod guard + real `isVerified` are covered by the id-staging M2M smoke. Image rebuild required to deploy (id-staging → prod-1). cn (prod-3) shares prod-1 Logto cross-border — no cn-side Logto deploy.

### TOTP authenticator-app issuer = brand name (2026-06-11)

**Why**: The `issuer` field of a TOTP `otpauth://` URI is what an authenticator app (Google Authenticator, 1Password, Authy, …) shows as the account's **title**. Upstream Logto hard-codes the issuer to the request hostname in every TOTP code path, so NiceMatrix users saw `id.nicematrix.com` instead of a brand name. This makes the title the fixed brand name **`NiceMatrix ID`**; the account sub-label (user email/username) is unchanged.

**Patch** (single brand constant + 4 call-site files, all `[NiceMatrix]` marked):
- `core/src/constants/mfa-issuer.ts` — **new file**, single source of truth: `export const mfaIssuerName = 'NiceMatrix ID'`.
- `core/src/routes/experience/classes/verifications/totp-verification.ts` — hosted-page **login-flow** MFA binding (the main path). `generateSecretQrCode()` uses `mfaIssuerName`; the now-unused hostname plumbing is removed and `generateNewSecret`'s `ctx` param is retained as `_ctx` so the caller route needs no override.
- `core/src/routes/interaction/additional.ts` — legacy interaction flow (register + sign-in branches; 2 `keyuri` calls). WebAuthn `rpId: ctx.URL.hostname` is intentionally left as the real domain.
- `core/src/routes/admin-user/mfa-verifications.ts` — admin Management API (`POST /users/:id/mfa-verifications`).
- `account/src/pages/TotpBinding/index.tsx` — Account Center self-service binding. Separate frontend bundle that can't import from `packages/core`, so it inlines the same `'NiceMatrix ID'` literal with a comment pointing back to `mfa-issuer.ts`. Keep both in sync.

**Risk surface**: zero. The issuer is a **display field only** — it is not part of the TOTP HMAC (secret + time step), so code generation/verification is unaffected for both existing and new bindings. No protocol/auth/DB change. Only **newly** created TOTP bindings show the new title; already-bound authenticator entries keep whatever issuer they were created with (cosmetic, no action needed). Image rebuild required (id-staging → prod-1).

### PostSignIn region routing (Logto-side fan-out filter) (2026-06-08)

**Why**: Cross-region design §6.5 (nicematrix-backend `docs/_plans/2026-06-04_cross-region-coordination-and-device-routing.md`). The `region` ExtraParam (below) lets each backend self-filter (S3b), but by default the SAME PostSignIn event is still fanned out to BOTH region hooks (the non-owning backend just drops it with `200 ignored`). That means an intl sign-in event still leaves the network toward prod-3 (and vice-versa) — functionally correct but not the cleanest data residency. This override lets a hook declare the region it owns so Logto only delivers matching events; the data of the other region is never sent out.

**Patch** (single file, `[NiceMatrix]` marked):
- `core/src/libraries/hook/index.ts` — `triggerInteractionHooks` PostSignIn fan-out filter now also checks `hookMatchesRegion(hook, region)`. A hook is region-tagged via `config.headers['x-nicematrix-region'] = 'intl' | 'cn'` (open `z.record(z.string())` header map → survives the config read guard, no schema change needed; also harmlessly forwarded as an HTTP header the backend ignores). Matching mirrors the backend exactly: payload `region` absent/empty → `intl`; `cn`/`intl` → that region; unknown → matches no tag. **Untagged hook = region-agnostic = receives ALL events (historical single-hook behavior; prod-1 stays untagged so its delivery is byte-identical to today).** Only PostSignIn is routed; data hooks (`User.Deleted`) stay global.

**Activation (S3c) — ✅ ACTIVATED 2026-06-08**: this override ships the *capability*; routing takes effect once a hook is tagged. Done on prod-1: hook `9aiz0tmuqb834vpu1nkcx` tagged `intl`, second cn hook `3wswwkcjxlh4snzrwcc3t` (PostSignIn → `apiv3.ej-mobile.cn/v1/webhook/logto`, `x-nicematrix-region: cn`, prod-3 signing key) registered + enabled. See `docs/custom-extra-params.md` §"Region routing activation (S3c)" for the steps, verification, and the native-vs-hosted pipeline note (native token-exchange logins fire NO PostSignIn — this hook serves hosted-page logins only; cn device control already runs via backend `applyNativeLoginControl`). Rollback = delete the cn hook + clear prod-1's `x-nicematrix-region` header.

**Risk surface**: zero impact when no hook is tagged (the only state today). Pure increment to the existing PostSignIn fan-out filter; non-PostSignIn interaction events and data hooks are untouched.

### `region` OIDC ExtraParam → PostSignIn webhook (2026-06-04)

**Why**: Cross-region device routing (S3a of nicematrix-backend `docs/_plans/2026-06-04_cross-region-coordination-and-device-routing.md`). After device_ref became deterministic + region-global, a roaming device exists in BOTH regions' `devices` tables and one Logto application serves cn+intl, so a PostSignIn webhook receiver cannot tell which backend owns the sign-in. The client now self-reports `region` (`intl`|`cn`) as an OIDC ExtraParam; the SAME PostSignIn event is fanned out to every registered hook (prod-1 + prod-3) and each backend processes only its own region (`region` self-filter in `admin-core/webhook.js`), 200-ignoring the rest. Missing region defaults to `intl` (historical single-hook behavior).

**Patch** (same 6-file ExtraParam chain as `device_ref`/`app_slug`; all marked `[NiceMatrix]`):
- `schemas/src/consts/oidc.ts` — add `Region='region'` to `ExtraParamsKey` enum + `extraParamsObjectGuard` + `ExtraParamsObject` type.
- `schemas/src/types/hook.ts` — `region?` on `InteractionApiMetadata` + `InteractionApiContextPayload`.
- `core/src/libraries/hook/context-manager.ts` — `region?` on `InteractionHookMetadata`.
- `core/src/libraries/hook/index.ts` — destructure `region` from metadata + include in payload.
- `core/src/routes/experience/middleware/koa-experience-interaction-hooks.ts` — extract `interactionDetails.params.region`.
- `core/src/routes/interaction/middleware/koa-interaction-hooks.ts` — same (legacy interaction route).

**Note**: `region` flows ONLY via `interactionDetails.params` → webhook (like `device_ref`), so `core/src/oidc/utils.ts` `buildLoginPromptUrl()` needs NO change (that file only appends params the experience SPA must read). `extraParams: Object.values(ExtraParamsKey)` in `core/src/oidc/init.ts` auto-registers the new enum value — zero OIDC-layer change.

**Risk surface**: zero protocol impact (unknown extraParams are pass-through; never enter token signing / redirect_uri validation). Clients that omit `region` behave exactly as before. Detail: `docs/custom-extra-params.md`.

### `packages/core/src/routes/admin-user/by-identity.ts` + `index.ts` (2026-06-02)

**Why**: Logto's Management API search covers only scalar columns (`id`, `primaryEmail`, `primaryPhone`, `username`, `name`) - never the `identities` jsonb. The internal `findUserByIdentity(target, userId)` (`queries/user.ts`) does the exact `identities #>> '{target,userId}'` lookup the experience/account flows use, but it was never exposed as a route. The NiceMatrix backend needs this reverse lookup so the **cross-region shared Logto user store is the single source of truth** for native social login (wechat/alipay/qq). Without it, each region kept a local `social_identity` ledger that split-brained (register region A, login region B -> miss -> duplicate Logto account + 502; the focc class of incident).

**Patch**:

- `admin-user/by-identity.ts` (new) - `GET /api/users/by-identity?target=<wechat|alipay|qq|apple|azuread>&userId=<value>`. Calls `queries.users.findUserByIdentity`. Target **allowlist** (no arbitrary jsonb key probing). Read-only. `200 { id, name, avatar }` on hit, `404` (`user.identity_not_exist`) on miss, `400` (`request.invalid_input`) on unknown target.
- `admin-user/index.ts` (override of upstream wiring) - registers `adminUserByIdentityRoutes` **before** `adminUserBasicsRoutes` so the static `/users/by-identity` path wins the koa-router match over `/users/:userId`.

**Risk surface**: pure increment, no existing route touched. Mounted on `managementRouter`, which already enforces M2M auth + `PredefinedScope.All` (koa-auth) - no new auth code. Real Logto ids are 12-char nanoids that never equal the literal `by-identity`, so the ordering is belt-and-braces. Unit test: `logto-custom/tests/test-by-identity.js` (5 cases). Image rebuild required to deploy (id-staging -> prod-1). Part of the 2026-06-02 native-login single-source-of-truth plan (Phase A).

### `packages/core/src/oidc/grants/token-exchange/index.ts` (2026-05-28)

**Why**: Upstream Logto's RFC 8693 token-exchange grant returns **only `access_token`** — never `id_token` or `refresh_token`. NiceMatrix native social login (wechat/alipay/qq) goes through this grant: backend mints a one-shot `subject_token` via `POST /api/subject-tokens`, the App exchanges it for OIDC tokens. Without a refresh_token the App must redo the entire native social handshake on every AT expiry (wechat `code` is one-shot, alipay token short-lived, qq openid+at fragile); without an id_token, ID-token-based user attribute retrieval breaks. RFC 8693 §2.2.1 explicitly permits both tokens in the response.

**Patch**: `core/src/oidc/grants/token-exchange/index.ts` — near-verbatim copy of upstream 1.40.1 with marked `[NiceMatrix override]` delta blocks:

- destructure `RefreshToken` + `IdToken` constructors from `provider`.
- issue `refresh_token` when `scope` has `offline_access` **and** `client.grantTypeAllowed(RefreshToken)`; anchor it to the **same `grantId`** as the access token so the standard `grant_type=refresh_token` grant rotates it normally; copy `jkt` / `x5t#S256` onto the RT for public clients (DPoP / mTLS binding), mirroring the auth_code grant.
- issue `id_token` when `scope` has `openid`, following the upstream refresh-token grant's id_token path verbatim (`filterClaims` → `getRejectedOIDCClaims` → `IdToken` → `conformIdTokenClaims` branch → `at_hash`). No `nonce`/`sid`/`auth_time` (no interactive session in token-exchange — correct).
- register the requested OIDC scope subset on the grant (idempotent) so id_token + follow-up refresh honour OIDC scopes even in the resource/org branches.
- response: conditionally spread `id_token` / `refresh_token` — requests without `openid` / `offline_access` get byte-identical upstream output.

**Risk surface**: pure increment, no protocol changes. id_token signing path is copied from Logto's own refresh-token grant (itself a node-oidc-provider fork). subject_token remains one-shot (second exchange → 400 `invalid_grant`).

**Verification** (2026-05-28 prod-1): matrix over no-scope / `openid` / `offline_access` / both / id_token claim validity / RT rotation / subject_token replay-reject — all pass. Container healthy in 8s after `force-recreate`. Backup tag: `nicematrix-logto:pre-token-exchange-rt-idtoken-20260528` (sha `8892ac362d24`). New image: `:token-exchange-rt-idtoken-20260528` (sha `b43890eb2f61`). Full detail: nicematrix-system memory `memory/changelog/logto-token-exchange-rt-idtoken-20260528.md`.

### `packages/schemas/src/consts/oidc.ts` + `packages/core/src/oidc/utils.ts` (2026-05-27)

**Why**: `oidc-provider` strips any query parameter that is not declared in `extraParams` when redirecting from `/oidc/auth` to the interaction URL (`/sign-in?...`). The Phase B native-caps takeover (mobile App → `cn.<app-scheme>://oauth/wechat` short-circuit) requires three params (`native_caps`, `native_scheme`, `app_slug`) to reach the experience SPA so it can write them into `sessionStorage`. Without this override they were silently dropped by the OIDC library and the user fell back to the upstream WeChat Web sign-in (扫一扫).

**Patch**:

- `schemas/src/consts/oidc.ts` — add `NativeCaps='native_caps'` + `NativeScheme='native_scheme'` to the `ExtraParamsKey` enum, the `extraParamsObjectGuard`, and the `ExtraParamsObject` type. (`AppSlug` / `DeviceRef` were already overridden for earlier features.)
- `core/src/oidc/utils.ts` — near-verbatim copy of upstream 1.40.1 file with a single delta block inside `buildLoginPromptUrl()`: 3 additional `appendExtraParam(ExtraParamsKey.AppSlug | NativeCaps | NativeScheme)` calls so the params are appended to the `/sign-in?...` URL. File header carries a `[NiceMatrix override]` marker for upstream-sync diffs.

**Risk surface**: zero protocol impact. `oidc-provider` treats unknown `extraParams` as pass-through, they never enter token signing or redirect_uri validation. PC entries that don't supply the three params see byte-identical behaviour to upstream (verified by Check B in deployment notes). Logto OIDC server still strictly enforces `applications.redirect_uris` (multi-layer defence).

**Verification** (2026-05-27 prod-1 deployment): mobile-UA `/oidc/auth?...&native_caps=wechat,alipay,qq&native_scheme=...&app_slug=...` → 303 to `/sign-in?app_id=...&app_slug=...&native_caps=...&native_scheme=...`. PC-UA without the three params → `/sign-in?app_id=...` clean. Container healthy in 9s after `force-recreate`, no errors in logs. Backup tag: `nicematrix-logto:pre-extraparam-fix-20260527` (sha `587c5e446baa`). New image: `:native-caps-extraparam-20260527` (sha `8892ac362d24`).

### `packages/connectors/connector-alipay-web/src/` (2026-05-25)

**Why**: Logto upstream `connector-alipay-web@1.6.3` Zod guards require `user_id` and only read `user_info_share_response.user_id` as identityId. This fails for:

1. **Post-2024-04-01 Alipay apps** — Alipay strictly enforces OpenID mode for new apps. Token endpoint returns `open_id` (e.g. `020A...`) instead of `user_id` (`2088xxx`); the response no longer contains `user_id`. Upstream Zod parse fails → `InvalidResponse` 400.
2. **Apps in Alipay Application Grouping** — Token endpoint returns `union_id` (groupwide identifier) which upstream ignores. Without using `union_id`, the same Alipay user appearing in different apps creates separate Logto identities.

**Patch**:

- `types.ts` — make `user_id` optional, accept `open_id` and `union_id` in both `alipaySystemOauthTokenResponseGuard` and `alipayUserInfoShareResponseGuard`.
- `index.ts` — extract identityId with priority `union_id > user_id > open_id`.

**Effect**:

| Scenario | identityId source |
|---|---|
| Legacy app, traditional mode | `user_id` (2088xxx) — unchanged |
| New app, OpenID mode, no grouping | `open_id` (020A...) |
| Any app in Application Grouping | `union_id` — preferred |

Upstream PR opportunity: yes (problem affects all post-2024-04-01 Alipay integrations).

