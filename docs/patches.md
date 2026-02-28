# Customizations

## Current policy (baseline)

To keep upgrades stable, we currently apply **visual-only** customization:

- Console topbar/welcome logo replacement
- Favicon replacement
- `logto.io` logo URL replacement

No auth/token behavior patches are applied in the baseline image.

## Location

- Patch script: `logto-custom/patches/console-branding.js`
- Build file: `deploy/Dockerfile`

## Upgrade checklist

1. Bump `FROM svhd/logto:<version>` in `deploy/Dockerfile`
2. Rebuild image
3. Verify branding patch still matches bundle markers
4. Run smoke tests:
   - sign-in
   - menu navigation
   - key admin pages load

## Future custom features

Behavior changes (e.g., username regex) should be implemented in the source-maintained workflow and documented with:

- reason
- exact files changed
- rollback path
- upgrade conflict notes
