# logto-custom

Custom layer for NiceMatrix.

## Structure

- `Dockerfile` - source-based image build using `logto-upstream/` + overrides
- `overrides/` - source file overrides (keep minimal)
- `branding/` - logo/icon assets used by overrides

## Rule

Do not patch built dist bundles. Customize at source level only.

## Current overrides

### `packages/schemas/src/consts/oidc.ts` + `packages/core/src/oidc/utils.ts` (2026-05-27)

**Why**: `oidc-provider` strips any query parameter that is not declared in `extraParams` when redirecting from `/oidc/auth` to the interaction URL (`/sign-in?...`). The Phase B native-caps takeover (mobile App → `cn.<app-scheme>://oauth/wechat` short-circuit) requires three params (`native_caps`, `native_scheme`, `app_slug`) to reach the experience SPA so it can write them into `sessionStorage`. Without this override they were silently dropped by the OIDC library and the user fell back to the upstream WeChat Web sign-in (扫一扫).

**Patch**:

- `schemas/src/consts/oidc.ts` — add `NativeCaps='native_caps'` + `NativeScheme='native_scheme'` to the `ExtraParamsKey` enum, the `extraParamsObjectGuard`, and the `ExtraParamsObject` type. (`AppSlug` / `DeviceRef` were already overridden for earlier features.)
- `core/src/oidc/utils.ts` — near-verbatim copy of upstream 1.39.0 file with a single delta block inside `buildLoginPromptUrl()`: 3 additional `appendExtraParam(ExtraParamsKey.AppSlug | NativeCaps | NativeScheme)` calls so the params are appended to the `/sign-in?...` URL. File header carries a `[NiceMatrix override]` marker for upstream-sync diffs.

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

