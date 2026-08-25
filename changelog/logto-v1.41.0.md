# Logto 1.40.1 → 1.41.0 (2026-07-11, staging + prod-1)

## What
- Self-compiled Logto upgraded to v1.41.0 (core-kit 2.11.0, upstream 91e55698a).
- Security: fixes CVE-2026-55377 (Account Center step-up bypass — directly relevant to us) + CVE-2026-55789 (SAML XML injection).
- New upstream features absorbed: app-level access control (default-off, verified no-op for our apps), TOTP replay protection, verification-code send rate limiting, password/username/verification-code policies, Account Center Sessions page (live at /account/sessions), SMTP2GO connector (linked, unconfigured).

## Override set: 89 → 87 files
- DROPPED SocialSection/index.tsx (upstream removed isApple from getLogoUrl — our fix now upstream behavior).
- DROPPED MfaSection/index.module.scss (upstream rewrote MFA rows into shared SecurityRow components; old selectors gone; mobile layout now upstream).
- token-exchange grant adopted 3-arg buildHandler + assertUserHasApplicationAccessForOidc; our id_token/refresh_token blocks preserved (verified: token-exchange returns all 3 tokens on staging AND prod).
- Home page wraps MfaSection in new MfaVerificationsProvider (+PasskeySection, renders null unless passkey sign-in enabled).
- Full merge details: repo nicematrix-id `docs/upgrade-1.41/PLAN.md` §12–13 (execution logs), commit 70d0e0a on main.

## Deploy notes
- DB alterations (9, all additive) MUST run via one-shot container on `nicematrix-id_default` network with explicit DB_URL (`docker exec` into the crash-looping logto container gets OOM/killed).
- LOGTO_VERSION env flipped to 1.41.0 on staging + prod-1 + prod-3 (+backend restarts). Dashboard tile reads this env.

## Rollback
- prod-1: image `nicematrix-logto:pre-1.41-backup-20260711_1822`, DB `/root/backups/logto_prod_pre_v1.41.0_20260711_1822.sql`
- staging: image `nicematrix-logto:pre-1.41-backup`, DB `/root/backups/logto_staging_pre_v1.41.0_20260711_1729.sql`
- Alterations additive; hard rollback = restore dump + retag + force-recreate.

## Post-upgrade review (2026-07-11 same-day)
- Full report: repo nicematrix-id `docs/upgrade-1.41/POST-UPGRADE-REVIEW.md` (commit fd35087).
- 19/20 merges verified correct; CVEs in; app-access-control confirmed no-op; alterations 9/9 both envs.
- **P1 open:** overrides avatar.ts (2 call sites) not adapted to 1.41 `getScopedProfile` `{profile,user}` shape → avatar upload/delete = HTTP 500 (write succeeds, response guard rejects; zod guard prevents any leak; 0 live requests). 2-line fix + rebuild, plan in report. P2: DELETE status list missing 500.
- Lesson: drift tool can't catch OUR-NEW files consuming upstream functions with changed signatures — next upgrade must grep OUR-NEW imports against upstream-changed modules.
