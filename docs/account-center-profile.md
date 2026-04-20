# Account Center Profile & Avatar Integration

Added 2026-04-20.

## Goal

Give end users a single `/account` page where they can manage both:

- Basic profile: avatar, family name, given name, nickname, birthdate, gender, address
- Account security: username, email, phone, password, social connections, MFA

Before this change, the Logto Account Center only exposed the security half;
basic profile editing had no UI at all and could only be performed by apps
calling `PATCH /api/my-account` / `PATCH /api/my-account/profile` with the
end-user access token. Avatar uploads were worse — the only upload endpoint
(`POST /api/user-assets`) is on the management API and required an M2M token
that browser apps should never hold.

## Solution

Two overrides in `logto-custom/overrides/`:

### 1. Logto core — user-scope avatar endpoints

`packages/core/src/routes/account/avatar.ts` (new) registers:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/my-account/avatar` | multipart upload → R2 via Logto `buildUploadFile` → sets `users.avatar` |
| DELETE | `/api/my-account/avatar` | clears `users.avatar` to `null` |

`packages/core/src/routes/account/index.ts` is overridden only to import and
mount `avatarRoutes(...args)` alongside the other sub-routes.

Access control enforced in the handler:

- access token must carry `openid` (already required by `koaOidcAuth`) and
  `UserScope.Profile`
- account-center field control `avatar` must be set to `Edit`
- storage provider (`SystemContext.shared.storageProviderConfig`) must be
  configured — identical check to upstream `user-assets.ts`
- MIME allow-list (`allowUploadMimeTypes`) and size limit (`maxUploadFileSize`)
  come from `@logto/schemas`

R2 object key layout:

```
<tenantId>/<userId>/avatars/yyyy/MM/dd/<randomId>/<originalFilename>
```

### 2. Account Center — ProfileSection UI

Files under `packages/account/src/` (all new unless noted):

```
apis/profile.ts              # updateProfile / updateName / uploadAvatar / deleteAvatar
i18n/profile-phrases.ts      # zh-CN / zh-HK / zh-TW / en injected via i18next.addResourceBundle
pages/Security/
  index.tsx                  # override: mount <ProfileSection /> above existing sections
  ProfileSection/
    index.tsx                # main row list + edit-modal orchestration
    index.module.scss
    AvatarEditor/            # avatar preview + hidden file input + client-side MIME/size guard
    TextFieldEditor/         # family name / given name / nickname
    DateFieldEditor/         # birthdate (HTML5 <input type=date>)
    SelectFieldEditor/       # gender (female / male / prefer_not_to_say)
    AddressEditor/           # address.formatted (only enabled sub-field today)
```

Interaction model: each row shows the current value; clicking *Edit* opens a
modal. Save → `PATCH /api/my-account/profile` (or the avatar endpoints) →
`refreshUserInfo()` → toast.

Field visibility respects `accountCenterSettings.fields.profile` /
`.avatar`: `Off` hides the whole group, `ReadOnly` shows values without the
Edit button.

Language bundles are injected at module load via
`i18next.addResourceBundle(language, 'translation', bundle, true, false)` so
we do not need to modify the upstream `@logto/phrases-experience` package.

## Client integration

Apps need **no new code** — users tap a single "Account settings" link that
points at `https://id.nicematrix.com/account?ui_locales=zh-Hans` (or any
desired locale). Logto's session is shared across apps on the same issuer,
so there is no extra sign-in.

Required OIDC scopes on the access token for full editing power:

- `openid` (required by the router)
- `profile` (all name/profile/avatar mutations)
- `address` (only if address edits should be allowed)
- `custom_data` (only if custom-data edits should be allowed)

## Build

```
cd /root/projects/nicematrix-id
docker build -f logto-custom/Dockerfile \
  --build-arg dev_features_enabled=true \
  -t nicematrix-logto:<tag> .
```

Rebuilds both `packages/core` (avatar routes) and `packages/account` (UI) in
a single pass. Nothing else in the stack is touched.

## Smoke tests

After restarting the container, calling the endpoints without a token should
give 401 (route exists, auth missing) rather than 404:

```
POST /api/my-account/avatar   → 401
DELETE /api/my-account/avatar → 401
POST /api/my-account/nonexistent → 404   # control
```

Fetching `https://<endpoint>/account/assets/index-<hash>.js | grep profile_section`
should yield the full list of ProfileSection i18n keys.

## Future work (not done here)

- Cropping UI for avatars (currently server accepts as-is)
- Dynamic reading of `custom_profile_fields` to render extra parts of
  `address` (streetAddress / locality / region / postalCode / country) when
  enabled — today only `formatted` is exposed
- Cleanup of old R2 avatar objects after successful replacement
