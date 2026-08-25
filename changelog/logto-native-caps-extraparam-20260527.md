# Logto override: native_caps OIDC passthrough — 2026-05-27

> Image: `nicematrix-logto:native-caps-extraparam-20260527` (sha `8892ac362d24`)
> Backup tag (prod-1): `nicematrix-logto:pre-extraparam-fix-20260527` (sha `587c5e446baa`, = previous `:scheme-relax-20260526`)
> Commit: `edfc1c8` (`logto-custom: pass native_caps/native_scheme/app_slug through /oidc/auth`)

## Problem

User reported that after passing `native_caps=wechat,alipay,qq` from mobile App, tapping the WeChat button still triggered the upstream WeChat **Web scan-QR** flow instead of the native takeover (Phase B / scheme `<scheme>://oauth/wechat`).

## Root cause

Phase B added the experience SPA override (`shouldHideTarget` / `buildTakeoverUrl`) plus `captureNativeCapsFromUrl()` that reads three params from `window.location.search` and writes them into sessionStorage. But the App opens **`/oidc/auth?...&native_caps=...&native_scheme=...&app_slug=...`**, not `/sign-in?...`.

`oidc-provider` only forwards query params declared in `extraParams` when building the interaction redirect URL. Logto's `extraParams` is sourced from `ExtraParamsKey` (`packages/schemas/src/consts/oidc.ts`). The three NiceMatrix params were not in that enum, so the library stripped them. The resulting `Location: /sign-in?app_id=...` no longer carried `native_caps`, `captureNativeCapsFromUrl()` saw empty `URLSearchParams`, sessionStorage stayed empty, `readValidatedCaps()` returned `null`, `buildTakeoverUrl()` returned `null`, and the click fell through to the standard `getSocialAuthorizationUrl()` Web OAuth flow.

`AppSlug` was already in the override enum (added earlier for `device_ref` / PostSignIn webhook), but `buildLoginPromptUrl()` never called `appendExtraParam(AppSlug)`, so even that was lost.

## Fix

Two-file override, minimal delta:

### `overrides/packages/schemas/src/consts/oidc.ts`
- Add `NativeCaps = 'native_caps'` + `NativeScheme = 'native_scheme'` to `ExtraParamsKey`
- Mirror entries in `extraParamsObjectGuard` (`z.string()`) and `ExtraParamsObject` type

### `overrides/packages/core/src/oidc/utils.ts` (new file)
- Near-verbatim copy of upstream 1.39.0 `packages/core/src/oidc/utils.ts` (391 lines)
- File header carries `[NiceMatrix override]` marker pointing at the delta block
- Inside `buildLoginPromptUrl()`, add 3 `appendExtraParam(...)` calls right after `Identifier`:
  ```ts
  appendExtraParam(ExtraParamsKey.AppSlug);
  appendExtraParam(ExtraParamsKey.NativeCaps);
  appendExtraParam(ExtraParamsKey.NativeScheme);
  ```

`diff upstream → override` = comment header + 8-line block. No other change.

## Why this is the safe approach

| Considered | Why rejected |
|---|---|
| Two pre-redirect HTTP hops (App fetches `/sign-in?native_caps=...` first to write sessionStorage, then jumps `/oidc/auth`) | Race condition inside ASWebAuthenticationSession when storage isolated; needs App-side coordination |
| Encode params into OIDC `state` | Pollutes RFC 6749 CSRF token semantics |
| Cookie-based pass-through | New attack surface, cross-subdomain replay risk |
| **Extend ExtraParamsKey (chosen)** | Uses Logto's existing pass-through mechanism. `oidc-provider` treats `extraParams` purely as forwarded query string; they never enter token signing, redirect_uri matching, PKCE, or any other OIDC protocol surface. Same pattern Logto itself uses for `ui_locales`, `login_hint`, `identifier`, etc. |

Multi-layer defence unchanged:
- Logto OIDC server still strictly enforces `applications.redirect_uris` against the requested `redirect_uri`
- experience SPA still applies hard `TAKEOVER_TARGETS` whitelist (`wechat` / `alipay` / `qq` only)
- experience SPA still validates `native_scheme` against `SCHEME_RE` + `DANGEROUS_SCHEMES` denylist
- HTTPS bridge endpoint (`/v1/social-bind/return`) still re-validates `<scheme>://oauth/social-bind` against `applications.redirect_uris`

## Build + deploy

1. `docker build -f logto-custom/Dockerfile -t nicematrix-logto:native-caps-extraparam-20260527 .` — ~14 min (pnpm -r build) + ~8 min (image export under disk pressure 78% used)
2. `docker save | gzip > /tmp/logto-native-caps-extraparam.tar.gz` — 310 MB
3. `scp` → prod-1 `/root/logto-native-caps-extraparam.tar.gz`
4. prod-1:
   - `docker tag nicematrix-logto:latest nicematrix-logto:pre-extraparam-fix-20260527` (backup)
   - `gunzip -c | docker load`
   - `docker tag nicematrix-logto:native-caps-extraparam-20260527 nicematrix-logto:latest`
   - `cd /var/www/nicematrix-id/deploy && docker compose --env-file /etc/nicematrix/id.env -p nicematrix-id up -d --force-recreate logto`
5. Health: `starting` → `healthy` in 9s. Total downtime ~12s.

## Verification (prod-1)

| Check | Command | Result |
|---|---|---|
| A | mobile-UA `/oidc/auth?...&native_caps=...&native_scheme=...&app_slug=...` | 303 → `/sign-in?app_id=...&app_slug=nicenote&native_caps=wechat%2Calipay%2Cqq&native_scheme=com.easyjoy.nicenote` ✅ |
| B | PC-UA `/oidc/auth?...` (no native_caps params) | 303 → `/sign-in?app_id=...` (no native_*) ✅ 0 regression |
| C | `https://id.nicematrix.com/console` | 200 ✅ |
| D | `docker logs --since 5m` errors | 0 ✅ |
| E | experience bundle `index-P2uPjrXx.js` still has `nmx_native_caps`/`nmx_native_scheme`/`nmx_app_slug` | yes ✅ |
| F | core `main-*.js` has all 3 new `appendExtraParam` patterns | yes ✅ |

## Rollback (if ever needed)

```
ssh root@46.224.6.74
docker tag nicematrix-logto:pre-extraparam-fix-20260527 nicematrix-logto:latest
cd /var/www/nicematrix-id/deploy && docker compose --env-file /etc/nicematrix/id.env -p nicematrix-id up -d --force-recreate logto
```

## Client-side prerequisite (App developer)

Logto end is now correct. App must implement the three native-takeover callback path branches inside `FlutterWebAuth2` / `ASWebAuthenticationSession` listener:

```dart
final cb = Uri.parse(cbUrl);
if (cb.path.startsWith('/oauth/wechat')) {
  // wechat native SDK → POST /v1/auth/wechat-native/login → Token Exchange
} else if (cb.path.startsWith('/oauth/alipay')) {
  // alipay native SDK ...
} else if (cb.path.startsWith('/oauth/qq')) {
  // qq native SDK ...
} else if (cb.path == '/oauth/callback') {
  // standard OIDC code exchange (default path)
}
```

User confirmed "app端会自行处理".
