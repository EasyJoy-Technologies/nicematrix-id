# logto-custom

Custom layer for NiceMatrix.

## Structure

- `Dockerfile` - source-based image build using `logto-upstream/` + overrides
- `overrides/` - source file overrides (keep minimal)
- `branding/` - logo/icon assets used by overrides

## Rule

Do not patch built dist bundles. Customize at source level only.

## Current overrides

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

