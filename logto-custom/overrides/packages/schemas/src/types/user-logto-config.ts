/*
 * [NiceMatrix override] vs upstream packages/schemas/src/types/user-logto-config.ts (v1.43.0).
 * Verbatim copy EXCEPT `userMfaSettingsResponseGuard`, which gains three read-only fields.
 *
 * WHY
 * `skipMfaOnSignIn` alone cannot answer "is two-step verification on for me": it is absent for
 * almost every account, and "absent" used to render as "on". Clients that instead read the
 * bound-factor list got it wrong the other way - having a factor is not the same as having the
 * feature switched on. Both mistakes were live in our integration docs.
 *
 * WHAT
 * Purely additive - no field removed, no semantics changed, so old clients keep working:
 *   - `isEnabled`       the one field clients should read from now on. True only when the user
 *                       explicitly turned two-step verification on, did not opt out at sign-in,
 *                       and still has a bound factor - i.e. exactly when sign-in will really
 *                       challenge them.
 *   - `hasUsableFactor` whether the toggle can be switched on at all.
 *   - `usableFactors`   which bound factors back that answer.
 * All three are produced by `core/src/libraries/user-mfa-state.ts`, the same module that drives
 * sign-in enforcement, so the API cannot disagree with what actually happens.
 *
 * See `docs/mfa-explicit-optin-plan.md` §4.
 * On upstream sync: re-copy this file and re-apply the three response fields.
 */
import { z } from 'zod';

import { MfaFactor } from '../foundations/index.js';

/**
 * The key for MFA-related data in user's logto_config
 */
export const userMfaDataKey = 'mfa';

/*
 * The key for passkey sign-in data in user's logto_config
 */
export const userPasskeySignInDataKey = 'passkey_sign_in';

/**
 * Schema for MFA-related data stored in user's logto_config
 */
export const userMfaDataGuard = z.object({
  /**
   * Whether the user has actively enabled/bound MFA factors
   *
   * Note: The `undefined` value indicates that a new user has never made a choice on enabling the optional MFA; or an
   * existing user data was created before the introduction of this field, so the MFA enabled state is unknown. We need
   * to check extra conditions to determine it when the user submits the experience interaction.
   * @see {@link @logto/core/packages/core/src/routes/experience/classes/mfa.ts#assertOptionalMfaEnablement}
   */
  enabled: z.boolean().optional(),
  /**
   * Whether the user has skipped MFA binding flow
   */
  skipped: z.boolean().optional(),
  /**
   * Whether the user has skipped optional additional MFA binding suggestion
   */
  additionalBindingSuggestionSkipped: z.boolean().optional(),
  /**
   * Whether the user has skipped MFA verification on sign-in
   *
   * Users can manually disable MFA verification requirement for sign-in,
   * but if the MFA policy is set to mandatory, this setting will be ignored.
   */
  skipMfaOnSignIn: z.boolean().optional(),
});

export type UserMfaData = z.infer<typeof userMfaDataGuard>;

/**
 * Schema for passkey sign-in related data stored in user's logto_config
 */
export const userPasskeySignInDataGuard = z.object({
  /**
   * Whether the user has skipped binding passkey for sign-in persistently
   */
  skipped: z.boolean().optional(),
});

export type UserPasskeySignInData = z.infer<typeof userPasskeySignInDataGuard>;

/**
 * Schema for the MFA settings API response (GET/PATCH /api/my-account/mfa-settings)
 */
export const userMfaSettingsResponseGuard = z.object({
  /**
   * Whether the user opted out of the second verification step at sign-in.
   *
   * Kept for backwards compatibility only. It answers "did the user opt out", not "is two-step
   * verification on" - read {@link isEnabled} for that.
   */
  skipMfaOnSignIn: z.boolean(),
  /**
   * [NiceMatrix] Whether two-step verification is really in effect: the user turned it on, did
   * not opt out at sign-in, and still has at least one bound factor. This is the single field
   * clients should use to display or drive a two-step verification switch.
   */
  isEnabled: z.boolean(),
  /**
   * [NiceMatrix] Whether the user has at least one bound factor, i.e. whether two-step
   * verification can be turned on at all. A primary email or phone alone does not count.
   */
  hasUsableFactor: z.boolean(),
  /**
   * [NiceMatrix] The bound factors that can serve a second verification step, in display order.
   */
  usableFactors: z.array(z.nativeEnum(MfaFactor)),
});

export type UserMfaSettingsResponse = z.infer<typeof userMfaSettingsResponseGuard>;

/**
 * Schema for user's logto_config field
 */
export const userLogtoConfigGuard = z.object({
  [userMfaDataKey]: userMfaDataGuard.optional(),
  [userPasskeySignInDataKey]: userPasskeySignInDataGuard.optional(),
});

export type UserLogtoConfig = z.infer<typeof userLogtoConfigGuard>;
