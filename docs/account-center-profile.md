# Account Center — Single-Page Architecture

> Last updated 2026-04-30 (Logto v1.39.0).
> Supersedes the original 2026-04-20 design (Profile + Security as two pages).

## Goal

Give end users **one** URL — `https://id.nicematrix.com/account` — to manage
everything about their account:

- **Profile**: avatar + 7 fields (display name, family name, given name,
  nickname, birthdate, gender, address)
- **Security**: username, email/phone, password, social connections, MFA
- **Delete Account**: 15-day grace period self-service deletion

`/account/profile` and `/account/security` are kept as **redirects** to
`/account` so old bookmarks and any in-app deep-links keep working.

## Why a single page

Logto v1.39 ships a sidebar layout with separate `/profile` + `/security`
+ `/delete-account` sub-pages. We override that to a single scrollable page
because:

1. End users have ~5–10 things to manage; a sidebar adds friction without
   structure benefit.
2. Mobile (the dominant client) has no room for a sidebar — upstream collapses
   it to a top tab bar, which is worse UX than scrolling.
3. Keeping all three concerns on one route lets us keep app-side deep-links
   trivial: any client just opens `/account` and the user finds what they need.

## URL & redirect map

| Path | Behaviour |
|------|-----------|
| `/account` | Single page rendering all three H2 sections (Profile / Security / Delete Account) |
| `/account/profile` | 302 → `/account` (bookmark compatibility) |
| `/account/security` | 302 → `/account` (bookmark compatibility) |
| `/account/...` (other) | Upstream Logto behaviour (verification / handle-* sub-flows) |

Implemented in `overrides/packages/account/src/App.tsx`:

```tsx
<Route path={securityRoute} element={<Navigate replace to="/" />} />
<Route path={profileRoute}  element={<Navigate replace to="/" />} />
```

## Page structure

`overrides/packages/account/src/pages/Home/index.tsx`:

```
H1 "Account Center"          ← hardcoded English; brand-stable
  H2 "Profile"
    ProfileSection           ← NiceMatrix override (avatar + 7 rows)
  H2 "Security"
    UsernameSection          ← upstream
    EmailPhoneSection        ← upstream (mobile SCSS forked)
    PasswordSection          ← upstream (mobile SCSS forked)
    SocialSection            ← upstream (mobile SCSS forked)
    MfaSection               ← upstream (mobile SCSS forked)
  H2 "Delete Account"
    DeletionSection          ← NiceMatrix override (no inner sub-title)
  PageFooter                 ← upstream (Terms / Privacy / Support links)
```

H1 / H2 labels are hardcoded English on purpose — upstream i18n keys
(`page.title`, `page.profile_title`, etc.) translate to values like
"Personal info" that conflict with the sub-card titles inside each section.
A small i18n bundle can be added later if Chinese is required.

## Server-side overrides

### Avatar endpoints (`overrides/packages/core/src/routes/account/`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/my-account/avatar` | multipart upload → R2 via Logto `buildUploadFile` → sets `users.avatar` |
| `DELETE` | `/api/my-account/avatar` | clears `users.avatar` to `null` |

Files:
- `avatar.ts` (new) — handler
- `index.ts` (override) — mounts `avatarRoutes(...args)` alongside upstream routes

Access control:
- access token must carry `openid` (enforced by `koaOidcAuth`) and
  `UserScope.Profile`
- account-center field control `avatar` must be set to `Edit`
- storage provider (`SystemContext.shared.storageProviderConfig`) must be
  configured (mirrors upstream `user-assets.ts`)
- MIME allow-list (`allowUploadMimeTypes`) and size limit (`maxUploadFileSize`)
  come from `@logto/schemas`

R2 object key layout:

```
<tenantId>/<userId>/avatars/yyyy/MM/dd/<randomId>/<originalFilename>
```

### Account deletion endpoint (`deletion-request.ts`)

NiceMatrix extension implementing the 15-day grace period flow. See
`docs/integration/logto-account-api.md` (backend repo) for the public
contract; the actual cron that performs the delete lives in
nicematrix-backend.

## Client-side overrides

All under `overrides/packages/account/src/`:

```
App.tsx                                   # /profile, /security → /account redirects
pages/Home/index.tsx                      # single-page layout (H1 + 3×H2)
pages/Home/index.module.scss              # section spacing + mobile padding

pages/Security/
  index.tsx                               # legacy entry, now mostly unused (Home owns layout)
  ProfileSection/                         # NiceMatrix new
    index.tsx                             # 7-row layout + edit-modal orchestration
    index.module.scss                     # desktop grid + mobile 2x2 grid
    AvatarEditor/                         # avatar preview + upload (client-side MIME/size guard)
    TextFieldEditor/                      # display name / family name / given name / nickname
    DateFieldEditor/                      # birthdate (HTML5 <input type=date>)
    SelectFieldEditor/                    # gender (female / male / prefer_not_to_say)
    AddressEditor/                        # address.formatted (the only sub-field enabled today)

  DeletionSection/index.tsx               # override: removes inner red sub-title; outer H2 only

  EmailPhoneSection/index.module.scss     # SCSS fork: mobile single-row layout
  UsernameSection/index.module.scss       # SCSS fork: mobile single-row layout
  PasswordSection/index.module.scss       # SCSS fork: mobile single-row layout
  MfaSection/index.module.scss            # SCSS fork: mobile single-row layout
  SocialSection/index.module.scss         # SCSS fork: mobile single-row + ellipsis

apis/profile.ts                           # updateProfile / updateName / uploadAvatar / deleteAvatar
i18n/profile-phrases.ts                   # zh-CN / zh-HK / zh-TW / en injected via i18next.addResourceBundle
```

Interaction model: each row shows the current value; clicking *Change* opens a
modal. Save → `PATCH /api/my-account/profile` (or `/api/my-account` for
`name`, or the avatar endpoints) → `refreshUserInfo()` → toast.

Field visibility respects `accountCenterSettings.fields.profile` /
`.avatar`: `Off` hides the whole group, `ReadOnly` shows values without the
*Change* button.

Language bundles are injected at module load via
`i18next.addResourceBundle(language, 'translation', bundle, true, false)` so
we do not need to modify the upstream `@logto/phrases-experience` package.

### Mobile layout strategy

Upstream v1.39 stacks every row to 3 lines on mobile (icon / label / value)
and renders the action button on a 4th line — wasteful on small screens.
Our 5 SCSS forks rewrite the mobile rules to keep rows on 1–2 grid lines:

- 4-col grid for icon-bearing rows (EmailPhone, Mfa): icon + label + value + button
- 3-col grid for non-icon rows (Username, ProfileSection): label + value + button
- Long values use `minmax(0, 1fr)` + `text-overflow: ellipsis` so they truncate
  inside the value cell instead of breaking the row
- Action button uses `align-self: center` (never top-aligned when value wraps)

Each forked SCSS file keeps the **desktop** section as a verbatim copy of
upstream so future Logto upgrades only diff against the mobile section.

## Logto design tokens (durable)

Authoritative source for SCSS tokens usable in `packages/account`:
`logto-upstream/packages/experience/src/shared/scss/_colors.scss`. The account
package only imports experience colours — it does **not** import core-kit
themes.

**Tokens that exist**: `--color-bg-body`, `--color-bg-float`, `--color-bg-light`,
`--color-bg-mask`, `--color-bg-layer-1`, `--color-bg-layer-2`,
`--color-line-divider`, `--color-overlay-neutral-hover`, `--color-type-primary`,
`--color-type-secondary`, `--color-type-link`, `--color-danger-default`,
`--color-danger-hover`, `--color-danger-toast-background`,
`--color-container-alert`, `--color-container-on-alert`,
`--color-on-alert-container`.

**Tokens that DO NOT exist** (silent failures — fall back to
inherited/transparent): `--color-warning-*` (no warning palette; use "alert"),
`--color-hover-variant` (console-only), `--color-layer-*` (correct prefix is
`--color-bg-layer-*`), `--color-border` (use `--color-line-divider`),
`--color-text*` (use `--color-type-*`), `--color-danger-40/50` (use
`default`/`hover`).

Pre-flight any new token:
`grep -r "tokenName" logto-upstream/packages/experience/src/shared/scss/_colors.scss`.

## Client integration

Apps need **no new code** — link the user to:

```
https://id.nicematrix.com/account?ui_locales=zh-Hans
```

(or any locale). Logto's session is shared across all clients on the same
issuer, so there is no extra sign-in.

Required OIDC scopes on the access token for full editing power:

- `openid` (required by the router)
- `profile` (all name/profile/avatar mutations)
- `address` (only if address edits should be allowed)
- `custom_data` (only if custom-data edits should be allowed)

Public API contract for the same operations is documented in
`nicematrix-backend/docs/integration/logto-account-api.md`.

## Build & deploy

```bash
cd /root/projects/nicematrix-id/deploy
docker compose --env-file /etc/nicematrix/id.env up -d --build
```

Build time ≈ 10–15 min. Required:

- `dev_features_enabled=true` build arg (set in both `Dockerfile` default
  and `docker-compose.yml`; without it Account Center security/social pages
  are compile-time stripped)
- `NODE_OPTIONS=--max-old-space-size=6144` in builder stage (production
  hosts with ≤8 GB RAM OOM during `packages/console` vite build otherwise)

Logto v1.39 introduced 3 DB alterations that must run before the new image
boots:

- `1.39.0-1774752400-add-delete-account-url`
- `1.39.0-1774770686-add-account-center-custom-css`
- `1.39.0-1776502301-add-sign-up-profile-fields`

Deploy order on a fresh upgrade:

1. Tag rollback: `docker tag nicematrix-logto:latest nicematrix-logto:rollback-YYYYMMDD-HHMM`
2. Sync source (`logto-upstream/` + `logto-custom/overrides/`)
3. `docker compose ... build` (do **not** recreate container yet)
4. Backup DB
5. If startup reports pending alterations: run `database alteration deploy next`
   from the new image
6. `docker compose ... up -d logto`
7. Verify OIDC + `/account/` + `docker logs nicematrix-logto --tail 60`

## Smoke tests

After restart, calling endpoints without a token returns 401 (route exists,
auth missing) — never 404:

```
HEAD /api/my-account/avatar          → 405
POST /api/my-account/avatar          → 401
DELETE /api/my-account/avatar        → 401
POST /api/my-account/nonexistent     → 404   # control
GET  /account/                       → 200
GET  /account/profile                → 302 → /account
GET  /account/security               → 302 → /account
GET  /oidc/.well-known/openid-configuration → 200
```

Bundle audit (sanity-check overrides made it into the build):

```bash
ASSET_HASH=$(curl -s https://id-staging.nicematrix.com/account/ \
  | grep -oE 'index-[A-Za-z0-9_-]+\.css' | head -1)
curl -s "https://id-staging.nicematrix.com/account/assets/$ASSET_HASH" \
  | grep -c 'display:contents'   # expect ≥ 5 (one per forked Section)
```

## Environments

| Domain | Host | Notes |
|--------|------|-------|
| `id-staging.nicematrix.com` | this build host (`135.181.147.90`) | Staging — all feature work verified here first |
| `id.nicematrix.com` | `46.224.6.74` | Production — only deploy after staging sign-off |

Issuer is domain-bound: tokens minted against `id-staging` are not valid on
`id.nicematrix.com` and vice versa.

## Future work

- Avatar cropping UI (server currently accepts as-is)
- Render extra `address` sub-fields (streetAddress / locality / region /
  postalCode / country) when the corresponding `custom_profile_fields` are
  enabled — today only `formatted` is exposed
- Cleanup of old R2 avatar objects after successful replacement
- Optional H1/H2 i18n bundle if Chinese branding is required
