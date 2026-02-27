# Custom Patches

## Username Regex (dots allowed)

**File:** `patches/username-regex.js`
**Applied in:** `Dockerfile` (build stage)
**Target Logto version:** 1.36.0

### Problem

Logto hardcodes username validation as `/^[A-Z_a-z]\w*$/`, which only allows letters, digits, and underscores. We need dots (`.`) for usernames like `xianglin.kong`.

This is not configurable via Logto DB or admin console — it's defined in `@logto/core-kit` source code and inlined in frontend bundles during build.

### Solution

Replace the regex with `/^[A-Z_a-z](?:[\w.]*\w)?$/`:
- First character: letter or underscore
- Middle: letters, digits, underscores, **dots**
- Last character: must NOT be a dot
- Single-character usernames remain valid

### Files Modified (6)

| File | Purpose |
|------|---------|
| `toolkit/core-kit/lib/regex.js` | Runtime definition (backend imports this) |
| `toolkit/core-kit/src/regex.ts` | TypeScript source (consistency) |
| `console/dist/assets/index-*.js` | Admin console frontend bundle |
| `experience/dist/assets/index-*.js` | Login page frontend bundle |
| `account/dist/assets/index-*.js` | Account settings frontend bundle |
| `demo-app/dist/assets/index-*.js` | Demo app frontend bundle |

### Upgrading Logto

When upgrading to a new Logto version:

1. Update `FROM svhd/logto:<version>` in `Dockerfile`
2. Run `docker compose build` — if the patch script fails, bundle filenames have changed
3. Check `patches/username-regex.js` — update file paths if needed
4. If Logto adds native dot support in usernames, remove this patch entirely
