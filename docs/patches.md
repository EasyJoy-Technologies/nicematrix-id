# Customizations

## Current policy

We now use **source-based customization** only.

- Upstream source: `logto-upstream/`
- NiceMatrix overrides: `logto-custom/overrides/`
- Build file: `logto-custom/Dockerfile`

No dist bundle patching is used in the active workflow.

## Active customizations

1. Username regex allows dot (`.`) in the middle:
   - Override file: `logto-custom/overrides/packages/toolkit/core-kit/src/regex.ts`
   - Rule: `/^[A-Z_a-z](?:[\w.]*\w)?$/`

2. Branding seed logos use NiceMatrix assets:
   - Override file: `logto-custom/overrides/packages/schemas/src/seeds/sign-in-experience.ts`
   - Logo URL: `https://m.nicematrix.com/branding/NiceMatrix-170x64.svg`

3. Console contact/brand external links:
   - Override file: `logto-custom/overrides/packages/console/src/consts/external-links.ts`
   - contactEmail: `support@nicematrix.com`
   - docs links remain official `docs.logto.io`

## How to add customization

1. Locate target source file in `logto-upstream/`.
2. Copy the same relative path into `logto-custom/overrides/`.
3. Edit only the required lines in the override copy.
4. Build via `deploy/docker-compose.yml` (which uses `logto-custom/Dockerfile`).
5. Document the change in this file and API/integration docs when behavior changes.

## Upgrade checklist

1. Bump `logto-upstream` submodule tag.
2. Rebuild image.
3. Resolve override drift if upstream files changed.
4. Run smoke tests (sign-in, menu navigation, core pages).
5. Update docs.
