/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * First-password gate (NiceNote account-center review 2026-09-27 H6). Upstream lets a user who has
 * no password / email / phone set a FIRST password with no verification at all, so a stolen bearer
 * token can be upgraded into a long-lived password. With
 *   NICEMATRIX_FIRST_PASSWORD_STEP_UP=on
 * `POST /api/my-account/password` requires a verified record for those users too; for them the only
 * way to get one is the social step-up (`social-step-up.ts`). Default OFF: current NiceNote builds
 * bootstrap a password before deletion, so turn it on only after clients switch to social step-up.
 * Changing it needs a Logto restart, not a rebuild.
 */
export const isFirstPasswordStepUpRequired = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env.NICEMATRIX_FIRST_PASSWORD_STEP_UP ?? '').trim().toLowerCase() === 'on';
