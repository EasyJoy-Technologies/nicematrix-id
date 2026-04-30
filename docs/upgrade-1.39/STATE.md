# 1.39 Upgrade — Live State

> Source of truth for resuming work after session interruption.
> Update this file at start and end of every action.

## Pointer
- **CURRENT_STAGE:** 0
- **LAST_COMPLETED:** 0.1 PLAN.md written
- **NEXT_ACTION:** 0.2 tag current prod image as backup
- **BLOCKER:** none
- **LAST_UPDATED:** 2026-04-29 21:25 MDT

## Decisions log
- 2026-04-29: User confirmed all 4 architectural decisions (see PLAN.md)
- 2026-04-29: User confirmed enabling WhatsApp connector

## Verified facts (don't re-discover)
- Logto v1.39.0 release tag: commit `d9f0db78b release: version packages (#8602)`
- Current prod image (running on `46.224.6.74`): `nicematrix-logto:latest` ≈ v1.38.0 base + our overrides
- Staging host: this server `debian-8gb-hel1-1` / `135.181.147.90` / `id-staging.nicematrix.com`
- Prod host: `46.224.6.74` / `id.nicematrix.com`
- Backend M2M resource indicator: `https://id.nicematrix.com/admin/api` — **MUST NOT change** during upgrade
- Logto webhook ID: `9aiz0tmuqb834vpu1nkcx` — relies on `deviceRef` + `appSlug` ExtraParams (our override in `schemas/oidc.ts`)
- v1.39.0 file additions affecting overrides:
  - 8 commits touching `account/src/App.tsx`
  - 3 commits touching `account/src/pages/Security/index.tsx`
  - 2 commits touching `core/src/routes/account/index.ts`
  - 2 commits touching `console/src/consts/external-links.ts`
  - 1 commit touching `core/src/routes/sign-in-experience/index.ts`
  - 1 commit touching `experience/src/containers/SocialSignInList/use-social.ts`
  - 1 commit touching `experience/src/pages/SocialSignInWebCallback/use-social-sign-in-listener.ts`
- All other 18 override files: 1.39 upstream content unchanged
- v1.39.0 deletes our path? Check: `core/src/routes/account/avatar.ts` and `deletion-request.ts` are OUR additions, not deleted upstream

## Files added/modified in this upgrade (will populate as we go)
(none yet)

## Outstanding decisions
- Stage 4.2 — final approach for DeletionSection vs upstream DeleteAccountSection: **decided to keep our Security/index.tsx override**
- Stage 6.4 — WhatsApp connector packaging method: TBD on inspection
