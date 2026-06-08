# logto-custom

Custom layer for NiceMatrix.

## Structure

- `Dockerfile` - source-based image build using `logto-upstream/` + overrides
- `overrides/` - source file overrides (keep minimal)
- `branding/` - logo/icon assets used by overrides

## Rule

Do not patch built dist bundles. Customize at source level only.

## Current overrides

### PostSignIn region routing (Logto-side fan-out filter) (2026-06-08)

**Why**: Cross-region design §6.5 (nicematrix-backend `docs/_plans/2026-06-04_cross-region-coordination-and-device-routing.md`). The `region` ExtraParam (below) lets each backend self-filter (S3b), but by default the SAME PostSignIn event is still fanned out to BOTH region hooks (the non-owning backend just drops it with `200 ignored`). That means an intl sign-in event still leaves the network toward prod-3 (and vice-versa) — functionally correct but not the cleanest data residency. This override lets a hook declare the region it owns so Logto only delivers matching events; the data of the other region is never sent out.

**Patch** (single file, `[NiceMatrix]` marked):
- `core/src/libraries/hook/index.ts` — `triggerInteractionHooks` PostSignIn fan-out filter now also checks `hookMatchesRegion(hook, region)`. A hook is region-tagged via `config.headers['x-nicematrix-region'] = 'intl' | 'cn'` (open `z.record(z.string())` header map → survives the config read guard, no schema change needed; also harmlessly forwarded as an HTTP header the backend ignores). Matching mirrors the backend exactly: payload `region` absent/empty → `intl`; `cn`/`intl` → that region; unknown → matches no tag. **Untagged hook = region-agnostic = receives ALL events (historical single-hook behavior; prod-1 stays untagged so its delivery is byte-identical to today).** Only PostSignIn is routed; data hooks (`User.Deleted`) stay global.

**Activation (S3c, decoupled from this override)**: this override ships the *capability*; routing only takes effect once a hook is tagged. The exact tag-prod-1-intl + register-prod-3-cn-hook steps are in `docs/custom-extra-params.md` §"Region routing activation (S3c)". Until cn goes live on hosted login, prod-1 stays untagged and no cn hook exists → zero behavior change.

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

