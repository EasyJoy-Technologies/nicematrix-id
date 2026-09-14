/*
 * [NiceMatrix new file] Single source of truth for "is two-step verification really ON for
 * this user". NOT an upstream file — nothing to re-sync on a Logto upgrade.
 *
 * WHY
 * Before this module the three places that answer the question disagreed with each other:
 *   - sign-in enforcement  (`MfaValidator.isMfaRequired`)
 *   - the Account API      (`GET /api/my-account/mfa-settings`, which only echoed
 *                           `skipMfaOnSignIn`)
 *   - the Account Center toggle
 * The drift was visible in production: 143,375 users saw the toggle as "on" while nothing was
 * ever enabled, and ~115,000 of them would really have been asked for an SMS/email code on the
 * hosted sign-in page because Logto counts `primaryPhone` / `primaryEmail` as *implicit* second
 * factors. See `docs/mfa-explicit-optin-plan.md` for the full analysis.
 *
 * THE RULE (product decision, 2026-09-14)
 *   two-step verification is ON  ⟺  the user explicitly turned it on
 *                                    AND has not opted out of it at sign-in
 *                                    AND still has at least one *bound* factor to verify with
 *
 *   isEnabled = mfa.enabled === true
 *             ∧ mfa.skipMfaOnSignIn !== true
 *             ∧ usableFactors.length > 0
 *
 * Differences from upstream 1.43, both deliberate:
 *   1. Upstream treats a missing `enabled` flag as "on" (legacy users are assumed enabled).
 *      We treat missing as "off" — the system must never turn it on for the user.
 *   2. Upstream counts the implicit email/phone factors as "the user has factors".
 *      We count only *bound* factors (decision D2). Email / phone remain fully available as a
 *      fallback channel inside the MFA challenge for users who do have a bound factor; they
 *      just cannot, on their own, make two-step verification "enabled".
 *
 * The third clause is not an extra restriction: with `enabled=true` but every factor deleted,
 * upstream could not enforce anything either. Including it is what makes "what we display"
 * provably identical to "what happens at sign-in".
 *
 * Consumers (all of them, so the three answers cannot drift again):
 *   - `routes/experience/classes/libraries/mfa-validator.ts` → sign-in enforcement
 *   - `routes/account/index.ts`                              → GET / PATCH /mfa-settings
 *   - `routes/account/mfa-verifications.ts`                  → last-factor removal
 */
import {
  MfaFactor,
  userMfaDataGuard,
  userMfaDataKey,
  type Mfa as MfaSettings,
  type User,
  type UserMfaData,
} from '@logto/schemas';

/** The only parts of a user record this module reads. */
export type UserMfaStateSource = Pick<User, 'logtoConfig' | 'mfaVerifications'>;

export type UserMfaState = {
  /**
   * Factors the user has actually bound AND that the current sign-in experience still accepts,
   * i.e. exactly the factors the MFA challenge could verify against. Implicit email / phone
   * factors are NOT included (decision D2).
   */
  usableFactors: MfaFactor[];
  /** Whether two-step verification can be turned on at all. */
  hasUsableFactor: boolean;
  /** Whether two-step verification is really in effect for this user. */
  isEnabled: boolean;
};

/**
 * Display order for `usableFactors`. Mirrors the priority upstream uses when it sorts the
 * factor list for the challenge screen (WebAuthn first, backup code last).
 */
const factorDisplayOrder: readonly MfaFactor[] = Object.freeze([
  MfaFactor.WebAuthn,
  MfaFactor.TOTP,
  MfaFactor.BackupCode,
]);

/** Read `logto_config.mfa`, tolerating the legacy shape where the key is absent entirely. */
export const parseUserMfaData = (logtoConfig: User['logtoConfig']): UserMfaData => {
  const parsed = userMfaDataGuard.safeParse(logtoConfig[userMfaDataKey]);
  return parsed.success ? parsed.data : {};
};

/**
 * Bound factors that can really be used for a second verification step.
 *
 * Mirrors the stored-factor half of upstream `getAllUserEnabledMfaVerifications()`:
 * a factor counts only when the sign-in experience still lists it, and a backup-code factor
 * with every code consumed does not count. The implicit email/phone half is intentionally
 * dropped (decision D2).
 *
 * Note `user.mfaVerifications` can only ever hold TOTP / WebAuthn / BackupCode entries
 * (`mfaVerificationGuard`), so it can never overlap with the implicit factors.
 */
export const getUsableMfaFactors = (
  mfaSettings: MfaSettings,
  user: UserMfaStateSource
): MfaFactor[] => {
  const boundFactors = user.mfaVerifications
    .filter((verification) => mfaSettings.factors.includes(verification.type))
    .filter(
      (verification) =>
        verification.type !== MfaFactor.BackupCode ||
        verification.codes.some(({ usedAt }) => !usedAt)
    )
    .map(({ type }) => type);

  return [...new Set(boundFactors)].sort(
    (factorA, factorB) =>
      factorDisplayOrder.indexOf(factorA) - factorDisplayOrder.indexOf(factorB)
  );
};

/** Resolve the complete two-step verification state of a user. */
export const getUserMfaState = (
  mfaSettings: MfaSettings,
  user: UserMfaStateSource
): UserMfaState => {
  const usableFactors = getUsableMfaFactors(mfaSettings, user);
  const hasUsableFactor = usableFactors.length > 0;
  const { enabled, skipMfaOnSignIn } = parseUserMfaData(user.logtoConfig);

  return {
    usableFactors,
    hasUsableFactor,
    isEnabled: enabled === true && skipMfaOnSignIn !== true && hasUsableFactor,
  };
};
