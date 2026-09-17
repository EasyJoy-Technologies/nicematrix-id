# logto-custom

Custom layer for NiceMatrix.

## Structure

- `Dockerfile` - source-based image build using `logto-upstream/` + overrides
- `overrides/` - source file overrides (keep minimal)
- `branding/` - logo/icon assets used by overrides

## Rule

Do not patch built dist bundles. Customize at source level only.

## Current overrides

### Passkey suggestion page: auto-skip on browsers without WebAuthn (2026-09-17)

Changelog: `changelog/logto-passkey-setup-skip-unsupported-20260917.md`

**Why**: with `passkey_sign_in.enabled` on, the server suggests binding a passkey at the end of
every interaction (422 `user.passkey_preferred`). Upstream's `PasskeySetup` answers a browser
without WebAuthn with a terminal `<ErrorPage>` — and the skip control lives on the layout that
branch never renders, so the interaction can never be submitted. On prod-1 over 60 days, 175
users reached that page and 81 (46%) never signed in again; the affected clients are Android
WebView and the stock Chinese-Android browsers Custom Tabs falls back to, so it cannot be fixed
client-side.

| File | Kind | Change |
|---|---|---|
| `experience/src/pages/PasskeySetup/index.tsx` | override | no-WebAuthn branch calls the existing skip endpoint automatically and continues the flow (loading layer meanwhile); upstream's error page stays as the fallback if that skip fails. `onSkip` returns a boolean so both paths share one implementation — the layout ignores it. |
| `experience/src/pages/PasskeySetup/index.test.tsx` | **new (ours)** | 4 cases, incl. the regression guard "a browser WITH WebAuthn never issues a skip request". |

**Deliberately unchanged**: the supported-browser path (options fetch, bind button, manual skip),
the meaning of the persisted `logto_config.passkey_sign_in.skipped` flag, the server-side
`assertPasskeySignInFulfilled`, and all three `passkey_sign_in.*` sign-in-experience switches.
No new i18n key.

### Two-step verification = explicit opt-in (2026-09-14, stage 2)

Plan: `docs/mfa-explicit-optin-plan.md` · changelog:
`changelog/logto-mfa-explicit-optin-20260914.md`

**Why**: upstream answers "is two-step verification on?" in three places that disagreed with each
other, and all three counted a user's `primaryEmail` / `primaryPhone` as an *implicit* second
factor. In production that meant 143,375 accounts saw an "on" switch they never set, ~115,000 of
them would really have been challenged for an SMS/email code on the hosted sign-in page, and one
hosted sign-in was enough for Logto to silently persist `mfa.enabled = true` for them forever.
NiceMatrix rule: the system never turns two-step verification on for a user.

**Shape**: one new NiceMatrix-owned module decides, everybody else consumes it.

| File | Kind | Change |
|---|---|---|
| `packages/core/src/libraries/user-mfa-state.ts` | **new (ours)** | `isEnabled = enabled === true ∧ skipMfaOnSignIn !== true ∧ bound factors ≠ ∅`; also exports `usableFactors` / `hasUsableFactor`. No upstream counterpart → zero upgrade maintenance. |
| `core/routes/experience/classes/libraries/mfa-validator.ts` | override | `isMfaRequired` consumes the module. Adaptive-MFA and mandatory-policy branches left byte-equivalent to upstream. |
| `core/routes/experience/classes/mfa.ts` | override | drops the silent `mfa.enabled = true` back-fill; skips the "set up two-step verification" suggestion for users who switched it off. |
| `core/routes/account/mfa-verifications.ts` | override (extended) | deleting the last usable factor writes `mfa.enabled = false`. |
| `core/routes/account/index.ts` | override (extended) | `GET/PATCH /mfa-settings` gain `isEnabled` / `hasUsableFactor` / `usableFactors`; `PATCH` accepts `isEnabled`, which writes both underlying flags at once. |
| `schemas/src/types/user-logto-config.ts` | override | the three response fields. |
| `account/src/pages/Security/MfaSection/index.tsx` | **new override** | switch binds to `isEnabled`, disabled with no bound factor (existing `no_verification_method_warning` phrase — no new i18n key). |
| `account/src/apis/mfa.ts` | override | `updateMfaSettings` payload accepts `isEnabled`. |
| `account/src/pages/Security/index.test.tsx`, `index.passkey.test.tsx` | override | upstream scenarios updated to the new contract + a new "disabled with no factor" case. 38 tests green. |

**Deliberately unchanged**: the sign-in suggestion page still uses upstream's implicit-inclusive
factor list (so the ~143,000 email/phone-only users gain no new prompt); email / phone remain
fallback channels inside the MFA challenge (`docs/mfa-deadlock-prevention.md`); mandatory MFA
policies still ignore per-user opt-out; no stored user data was migrated or back-filled.

### `packages/core/src/routes/account/mfa-verifications.ts` — MFA-neutral upgrade (2026-09-14)

**Why**: upstream 1.42 (`d91696c70`) made the Account API write `logtoConfig.mfa.enabled = true`
at every factor-binding call site (TOTP create, backup codes create, WebAuthn create, TOTP
verify-and-bind — 4 places). That turns "the user added a verification method" into "the system
switched two-step verification on for them", contradicting the NiceMatrix rule that two-step
verification is on only when the user explicitly turns it on. Taking the 1.42 behaviour as part of
the 1.43 upgrade would also mean the upgrade silently changes MFA semantics, making any production
incident impossible to attribute cleanly.

**Patch**: verbatim copy of upstream 1.43.0 with the four `logtoConfig:
buildUpdatedUserLogtoConfig(user, { mfa: { enabled: true } })` writes removed (and the two imports
that existed only for them). Purely subtractive — binding a factor again writes only
`mfaVerifications`, exactly as 1.41 did.

**Risk surface**: all six readers of `mfa.enabled` in 1.43 were checked. `isMfaRequired`
(sign-in enforcement), the legacy interaction verifier, `account/logto-config.ts`,
`admin-user/basics.ts` and `libraries/user-logto-config.ts` are unaffected. The only visible path is
`experience/classes/mfa.ts assertOptionalMfaEnablement`: a user with factors bound but
`enabled=false` sees the "turn on two-step verification" page once; that page has a Skip button which
persists `mfa.skipped=true` and never prompts again — which is exactly today's 1.41 behaviour, not
something this override introduces.

**Scope**: stage 1 (upgrade neutrality) only. The explicit-opt-in redesign — including the separate,
pre-existing `assertMfaEnabledOrSuggest` → `markMfaEnabled()` silent back-fill — is stage 2
(`docs/mfa-explicit-optin-plan.md`), where this override is expected to be retired or rewritten once
`user-mfa-state` owns the judgement.

### QQ ICP social callback origin (`experience/src/utils/social-redirect-override.ts` + 3 call sites)

**Why**: QQ互联 requires the OAuth callback domain to carry a Chinese ICP filing.
`id.nicematrix.com` has none; `id.ej-mobile.cn` does. The helper rewrites the callback origin for
the QQ connector only (`getSocialCallbackUri(connectorId)` → ICP host for QQ, plain
`window.location.origin` for everything else — i.e. byte-identical to upstream). The ICP host
302-bounces the whole path+query back to `id.nicematrix.com`, so cookies and sessionStorage stay on
the real origin.

**Call sites** (all three must produce the SAME string, since the authorization request and the
later verification are matched on it):
- `experience/src/pages/SocialSignInWebCallback/use-social-sign-in-listener.ts` (sign-in flow)
- `account/src/pages/SocialFlow/index.tsx` (Account Center, 2 places: add + change)
- `account/src/pages/SocialCallback/index.tsx` (Account Center verification)

**1.43 change (2026-09-14)**: upstream `b64d46d495` **unified the Sign-in Experience and Account
Center social callback URI** on `/callback/:connectorId`, routed by an OAuth `state` prefix
(`ac_` → Account Center, `se_` → Experience) in the new `core/src/routes/callback.ts` GET handler —
explicitly so single-redirect-URI connectors like QQ can serve both flows. Effects on this override:
- Account Center no longer builds `/account/callback/social/:connectorId`, so all three call sites
  now share the one `getSocialCallbackUri()` helper instead of two different path shapes. This is a
  simplification *and* a fix: before, the two flows sent QQ two different redirect URIs.
- The ICP bounce needs no change — it is a generic path+query-preserving 302 (re-verified live:
  `https://id.ej-mobile.cn/callback/<qq>?...&state=ac_...` → 302 → same path/query on
  `id.nicematrix.com`, which then 303s to the account-center callback).
- The old `extractConnectorIdFromPath()` fallback in `SocialCallback` was **dropped**: upstream
  renders that component inside `<Routes path={"/callback/social/:connectorId"}>`, so `useParams()`
  always resolves and the fallback was dead code.

### RETIRED — `packages/core/src/libraries/custom-profile-fields/index.ts` (added 2026-07-15, retired 2026-09-14)

**Was**: exempted the column-backed built-ins `name` / `avatar` from the
`custom_profile_fields` existence check, because the 1.41 admin seed
(`profileFields: [{name}, {avatar}]`) made every Console "Sign-in & account" save fail with
`custom_profile_fields.entity_not_exists_with_names: name, avatar`.

**Why retired**: upstream 1.43 fixed the same root cause differently. The sign-in-experience and
account-center save paths now call a new `normalizeProfileFields()` which *drops* references to
fields absent from the catalog instead of throwing, and `validateProfileFieldsList()` is left for
APIs that intentionally address catalog rows (SIE order updates) — exactly where our exemption
would have been wrong. Keeping the override would have weakened a check upstream deliberately
narrowed. Verified safe for us: prod-1's `default` tenant has `account_centers.profile_fields =
NULL`, and the NiceMatrix Account Center renders its own `ProfileSection` which never reads
`profileFields`.

> Deploy note: `skills/nicematrix-id-logto-deploy` step 4 (prod-only lineage guard) names
> `profilefields-fix-20260715`. That lineage is **intentionally absent** from 1.43.0 onwards.

### `packages/connectors/connector-oidc/src/` — `identitySource` (sub|oid) (2026-06-18)

**Why**: The Microsoft (Entra) connector was migrated from `azuread` to the standard `oidc` connector on 2026-06-17 (for OneDrive token-vault support — the `azuread` connector has no token storage). The stock `oidc` connector hard-codes the Logto identity id to the `sub` claim. Microsoft `sub` is a **pairwise** identifier — unique per *user AND per OIDC application/client_id* — so it differs from the id the old `azuread` connector stored (Graph `id` = MSA CID = `oid` tail) and would change again on any future app/connector re-creation. Result: every existing Microsoft user was re-orphaned (treated as a new user) after the migration. Microsoft's documented immutable, app-independent, Graph-aligned user key is **`oid`** (tenant-stable; strict global = `oid`+`tid`). This override lets the connector key on `oid` instead of `sub`.

**Patch** (3 files, full-copy of upstream 1.40.1 with marked `[NiceMatrix]` deltas — verified by `diff` to differ from upstream ONLY by these blocks):
- `types.ts` — (1) add `oid: z.string().nullish()` to `idTokenProfileStandardClaimsGuard` so the `oid` claim survives the zod parse into `result.data` (upstream `z.object` strips unknown keys); (2) add `identitySource: z.enum(['sub','oid']).optional().default('sub')` to `oidcConnectorConfigGuard`.
- `index.ts` — single delta block in `parseUserInfoFromIdToken`: `const id = config.identitySource === 'oid' ? oid : sub;` then **throw** `SocialIdTokenInvalid` if the selected claim is absent. **No silent fallback to `sub`** — a fallback would mint a different id than the migrated records and re-orphan the user (the exact bug being fixed). Everything else is verbatim.
- `constant.ts` — add an `identitySource` **Select** form item (default `sub`) so the field is visible/editable in Console and not dropped on connector edit-save.

**Risk surface**: zero for non-Microsoft OIDC. `identitySource` defaults to `sub`, so any oidc connector that does not set it (and every other social connector) behaves byte-identically to upstream. `oid` is set ONLY on the Microsoft connector config. Requires `profile` scope (already in the Microsoft connector scope) for `oid` to be emitted. Unit test: `logto-custom/tests/test-oidc-identity-source.js` (6 cases incl. the no-silent-fallback safety case). Paired with a one-time existing-data normalization (xianglin CID→full-oid zero-pad; jie.hua duplicate sub-binding removed; legacy_cn already oid) and an id-staging real-Microsoft login smoke. Image rebuild required (id-staging → prod-1; cn/prod-3 shares prod-1 Logto cross-border). Detail: nicematrix-system `changelog/`.

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

> **1.43 rewrite (2026-09-14)** — the override was re-derived on the v9 skeleton, not re-applied.
> 1.42 moved Logto to node-oidc-provider **v9** + Koa 3: the grant handler signature became
> `(ctx)` with no `await next()`, and all token-endpoint internals now come from the
> `#src/oidc/oidc-provider-internals.js` seam module (the only module allowed to deep-import
> `oidc-provider/lib/**`). Consequences for this override:
> - the hand-rolled id_token block (~35 lines: deep `filter_claims.js` import, manual
>   `conformIdTokenClaims` branch, manual `at_hash`) is **replaced by the shared
>   `issueIdToken()` helper**, the same one the forked refresh_token grant uses. The override is
>   now shorter and strictly closer to upstream.
> - **`at_hash` is no longer set, and the ID-token JWT header no longer carries `typ: "JWT"`.**
>   That is an upstream-wide v9 change, not a NiceMatrix decision. Official Logto SDKs are
>   unaffected; clients that hand-roll ID-token validation must not require those two.
> - the response is built with the shared `buildTokenResponse()`, so a request without
>   `openid` / `offline_access` gets byte-identical upstream output.
> - the refresh_token block stays hand-written (and keeps its explicit
>   `offline_access && grantTypeAllowed` gate rather than delegating to the provider's
>   `issueRefreshToken` hook) so the issuance rule is provably unchanged by the upgrade.
> - the multi-resource `Object.create(ctx)` derivation was **re-verified against the v9 fork**
>   (`lib/helpers/resolve_resource.js`): the array → `defaultResource()` → `InvalidTarget`
>   sequence is unchanged, and upstream's own 1.43 fake model `new Set([params.resource])` would
>   additionally fail the membership check when `resource` is repeated — so the delta is still
>   load-bearing. All 16 cases of `logto-custom/tests/test-token-exchange-multi-resource.js` pass.

**Patch**: `core/src/oidc/grants/token-exchange/index.ts` — near-verbatim copy of upstream with marked `[NiceMatrix override]` delta blocks:

- destructure `RefreshToken` + `IdToken` constructors from `provider`.
- issue `refresh_token` when `scope` has `offline_access` **and** `client.grantTypeAllowed(RefreshToken)`; anchor it to the **same `grantId`** as the access token so the standard `grant_type=refresh_token` grant rotates it normally; copy `jkt` / `x5t#S256` onto the RT for public clients (DPoP / mTLS binding), mirroring the auth_code grant.
- issue `id_token` when `scope` has `openid`, following the upstream refresh-token grant's id_token path verbatim (`filterClaims` → `getRejectedOIDCClaims` → `IdToken` → `conformIdTokenClaims` branch → `at_hash`). No `nonce`/`sid`/`auth_time` (no interactive session in token-exchange — correct).
- register the requested OIDC scope subset on the grant (idempotent) so id_token + follow-up refresh honour OIDC scopes even in the resource/org branches.
- response: conditionally spread `id_token` / `refresh_token` — requests without `openid` / `offline_access` get byte-identical upstream output.

**Risk surface**: pure increment, no protocol changes. id_token signing path is copied from Logto's own refresh-token grant (itself a node-oidc-provider fork). subject_token remains one-shot (second exchange → 400 `invalid_grant`).

**Verification** (2026-05-28 prod-1): matrix over no-scope / `openid` / `offline_access` / both / id_token claim validity / RT rotation / subject_token replay-reject — all pass. Container healthy in 8s after `force-recreate`. Backup tag: `nicematrix-logto:pre-token-exchange-rt-idtoken-20260528` (sha `8892ac362d24`). New image: `:token-exchange-rt-idtoken-20260528` (sha `b43890eb2f61`). Full detail: nicematrix-system memory `changelog/logto-token-exchange-rt-idtoken-20260528.md`.

#### Multi-resource extension (2026-08-06)

**Why**: A CN login session serves **two** API resources — business `https://apiv3.ej-mobile.cn` and self-hosted store `https://api.nicematrix.com` (prod-1 only, shared by CN + Intl). The block above stored a **single** `params.resource` on the minted refresh token, so a later `grant_type=refresh_token&resource=<the other one>` failed `InvalidTarget` (`resolve_resource.js`: `if (resource && !model.resourceIndicators.has(resource)) throw`). Clients read that as a dead session, called `RevokeToken`, and looped back through native login. Measured on 2026-08-06 (prod-1 Logto audit log): nicelist 53 `invalid_target` / 15 users / 53 forced re-logins (baseline ~13) / 51 revokes (baseline ~8); nicerecorder reproduced it with 1 user. **Not app-specific** — all 2406 token-exchange refresh tokens ever minted store a single string, vs 117 array-valued ones from `authorization_code` (which lets `authorize` declare several resources and therefore already worked). Verified live: `nicerecorder` user `ii1r0gcbut29` looped 4× on the native path, then succeeded twice at 16:45/17:50 the moment the client switched to a hosted-page login declaring both resources — with zero server-side change.

**Patch** (same file, 3 further `[NiceMatrix override]` blocks): the grant is already registered with `resource` as a **duplicable** parameter (`registerGrants()` → `getParameterConfig`), so `params.resource` may arrive as an array; only the handler ignored it.

- normalize `params.resource` to `requestedResources: string[]` (drops empty / non-string); `requestedResources[0]` is the primary and remains the access token's single `aud` (a JWT audience must be one value).
- pass `resolveResource` a **derived `ctx`** (`Object.create` prototype shadowing) pinning `params.resource` to the primary. It must never receive an array: before throwing on arrays it routes them through `resourceIndicators.defaultResource()`, and Logto's implementation **ignores the candidates** and returns the tenant-wide default — silently minting a token for the WRONG audience. Single-resource requests get the untouched `ctx`.
  - ⚠️ **Do not use a `Proxy` here.** `ctx.oidc` is a non-configurable, non-writable data property, so the ES proxy invariant forces a `get` trap to return that exact object; returning a wrapper throws `TypeError: 'get' on proxy: property 'oidc' is a read-only and non-configurable data property`. The first implementation did exactly that and 500'd on the id-staging smoke (caught pre-production, 2026-08-06). `Object.create` has no such invariant: it keeps the whole prototype chain (accessors + methods resolve normally), shadows only `params`, and leaves the caller's real `ctx` unmutated. A unit case asserts the Proxy form throws, so this cannot regress silently.
- register every secondary indicator on the same grant via `getResourceServerInfo` + `grant.addResourceScope`, because `refresh_token` derives its scope from `grant.getResourceScopeFiltered(resource, …)`, which returns `''` for a resource the grant never recorded. An unregistered indicator makes `getResourceServerInfo` throw `InvalidTarget` **at login**, rather than minting an RT that quietly cannot serve it.
- persist `resource: requestedResources.length > 1 ? requestedResources : primaryResource` on the RT.

**Risk surface**: **zero for single-resource clients** — 618/618 token-exchange calls in the preceding 30 days sent one string, and that path stores a bare string exactly as before, skips the proxy, and registers no secondary. Existing stored refresh tokens are never rewritten (nicerecorder 1615 / nicenote 1067 / nicelist 619 all remain `string`), and `BaseToken#resourceIndicators` already normalizes both shapes via `Array.isArray(this.resource) ? this.resource : [this.resource]`. Rotation is shape-agnostic: upstream copies `resource: refreshToken.resource` verbatim. Both indicators currently expose 0 scopes, so access-token scope is `''` either way. The `organization_id` branch is untouched.

**Client contract**: send the `resource` parameter twice on the token-exchange call. Independently, `invalid_target` must **never** trigger `RevokeToken` — it is a configuration error, not an expired session; treat it as "store unavailable" and keep the session. That reflex caused the re-login loop.

**Tests**: `logto-custom/tests/test-token-exchange-multi-resource.js` (16 cases; 4 single-resource regression guards, 3 for the derived-ctx mechanism, plus the defaultResource trap and the fail-fast case).

**Verification** (2026-08-06, id-staging, image `:token-exchange-multi-resource-20260806` sha `d12c68dd3224`; throwaway app + user, both deleted afterwards):

| # | case | result |
|---|---|---|
| A | dual-resource token-exchange | 200, `aud` = primary, `id_token` + `refresh_token` present |
| B | refresh for the **secondary** resource | 200, `aud` = secondary — **the production bug, fixed** |
| C | single-resource token-exchange | 200, RT stored as bare **string** (regression) |
| D | single-resource refresh | 200, `aud` correct (regression) |
| E | single-resource RT → a different resource | `invalid_target`, still correctly rejected |
| F | unknown secondary at login | `invalid_target`, fail-fast as designed |

RT rows: multi = jsonb **array** (both indicators, preserved across rotation), single = jsonb **string**. Zero `server_error` in the container log; container healthy. Rollback tag: `nicematrix-logto:pre-multi-resource-20260806` (sha `955ff9c7fab5`).

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

