/*
 * [NiceMatrix override] vs upstream packages/core/src/routes/experience/classes/libraries/
 * mfa-validator.ts (v1.43.0). Verbatim copy EXCEPT the `isMfaRequired` getter.
 *
 * WHY
 * Upstream enforces MFA at sign-in for any user who "has factors", where "has factors"
 * includes the *implicit* email / phone factors derived from `primaryEmail` / `primaryPhone`,
 * and where a missing `mfa.enabled` flag is read as "enabled". On production that meant
 * ~115,000 users who had never set up two-step verification would be asked for an SMS / email
 * code on the hosted sign-in page — a second factor nobody ever agreed to. See
 * `docs/mfa-explicit-optin-plan.md` §1-§2.
 *
 * WHAT
 * The optional-policy branch now consumes `getUserMfaState()`, the single source of truth
 * shared with `GET /api/my-account/mfa-settings` and the Account Center toggle, so the state
 * we display and the behaviour at sign-in cannot drift apart. MFA is required only when the
 * user explicitly enabled it, did not opt out, and still has a *bound* factor.
 *
 * WHAT IS DELIBERATELY UNCHANGED
 *   - Adaptive MFA (`adaptiveMfaResult !== undefined`): untouched upstream logic. Adaptive MFA
 *     is a risk-signal feature with its own opt-in and is disabled on every NiceMatrix tenant.
 *   - Non-skippable policies (`isNoSkipMfaPolicy`): untouched upstream logic. When the tenant
 *     mandates MFA, a per-user opt-out must not weaken it — upstream ignores both flags there
 *     and so do we (byte-equivalent outcome: upstream's `&& !isNoSkipMfaPolicy(...)` guard).
 *   - `userEnabledMfaVerifications` / `availableUserMfaVerificationTypes`: untouched. Once a
 *     challenge is required, email / phone remain available as fallback channels — that is the
 *     MFA-deadlock defence (`docs/mfa-deadlock-prevention.md`) and it still applies, because a
 *     challenge can now only happen to users who do have a bound factor.
 *
 * On upstream sync: re-copy this file and re-apply the `isMfaRequired` body below.
 */
import {
  MfaFactor,
  VerificationType,
  type Mfa,
  type User,
} from '@logto/schemas';
import { type Optional } from '@silverhand/essentials';

import { isNoSkipMfaPolicy } from '#src/libraries/sign-in-experience/mfa-policy.js';
// [NiceMatrix] shared explicit-opt-in judgement, see the file header.
import { getUserMfaState } from '#src/libraries/user-mfa-state.js';

import { type InteractionProfile } from '../../types.js';
import { getAllUserEnabledMfaVerifications } from '../helpers.js';
import { type BackupCodeVerification } from '../verifications/backup-code-verification.js';
import {
  type MfaEmailCodeVerification,
  type MfaPhoneCodeVerification,
} from '../verifications/code-verification.js';
import { type VerificationRecord } from '../verifications/index.js';
import { type TotpVerification } from '../verifications/totp-verification.js';
import { type WebAuthnVerification } from '../verifications/web-authn-verification.js';

import type { AdaptiveMfaResult } from './adaptive-mfa-validator/types.js';

const mfaVerificationTypes = Object.freeze([
  VerificationType.TOTP,
  VerificationType.BackupCode,
  VerificationType.WebAuthn,
  VerificationType.MfaEmailVerificationCode,
  VerificationType.MfaPhoneVerificationCode,
]);

type MfaVerificationType =
  | VerificationType.TOTP
  | VerificationType.BackupCode
  | VerificationType.WebAuthn
  | VerificationType.MfaEmailVerificationCode
  | VerificationType.MfaPhoneVerificationCode;

const mfaVerificationTypeToMfaFactorMap = Object.freeze({
  [VerificationType.TOTP]: MfaFactor.TOTP,
  [VerificationType.BackupCode]: MfaFactor.BackupCode,
  [VerificationType.WebAuthn]: MfaFactor.WebAuthn,
  [VerificationType.MfaEmailVerificationCode]: MfaFactor.EmailVerificationCode,
  [VerificationType.MfaPhoneVerificationCode]: MfaFactor.PhoneVerificationCode,
}) satisfies Record<MfaVerificationType, MfaFactor>;

type MfaVerificationRecord =
  | TotpVerification
  | WebAuthnVerification
  | BackupCodeVerification
  | MfaEmailCodeVerification
  | MfaPhoneCodeVerification;

const isMfaVerificationRecord = (
  verification: VerificationRecord
): verification is MfaVerificationRecord => {
  return mfaVerificationTypes.includes(verification.type);
};

export class MfaValidator {
  constructor(
    private readonly mfaSettings: Mfa,
    private readonly user: User,
    private readonly adaptiveMfaResult?: Optional<AdaptiveMfaResult>
  ) {}

  /**
   * Get the enabled MFA factors for the user
   *
   * - Filter out MFA factors that are not configured in the sign-in experience
   * - Include implicit Email and Phone MFA factors if user has them and they're enabled in SIE
   */
  get userEnabledMfaVerifications() {
    return getAllUserEnabledMfaVerifications(this.mfaSettings, this.user);
  }

  /**
   * For front-end display usage only.
   * Returns all the available MFA verifications for the user that can be used for verification.
   *
   * - Filter out backup codes if all the codes are used
   * - Filter out duplicated verifications with the same type
   * - Sort by last used time, the latest used factor is the first one, backup code is always the last one
   */
  get availableUserMfaVerificationTypes() {
    return (
      this.userEnabledMfaVerifications
        // Filter out duplicated verifications with the same type
        .reduce<MfaFactor[]>((verifications, verification) => {
          if (verifications.includes(verification)) {
            return verifications;
          }

          return [...verifications, verification];
        }, [])
    );
  }

  /**
   * Whether MFA verification is required for the current sign-in interaction.
   *
   * Decision order:
   * 1. If adaptive MFA is enabled (result defined):
   *    - triggered + user has factors → required
   *    - otherwise → not required
   * 2. If adaptive MFA is disabled (result undefined):
   *    - non-skippable policy → user has factors (implicit ones included) → required
   *    - otherwise → [NiceMatrix] required only when two-step verification is explicitly on
   */
  get isMfaRequired(): boolean {
    const hasUserFactors = this.userEnabledMfaVerifications.length > 0;

    if (this.adaptiveMfaResult !== undefined) {
      // Verification guard only applies when the user already has MFA factors
      // enabled in the current sign-in experience.
      return this.adaptiveMfaResult.requiresMfa && hasUserFactors;
    }

    // The tenant mandates MFA: a per-user opt-out must not weaken it. Identical to upstream,
    // whose `&& !isNoSkipMfaPolicy(policy)` guard makes both user flags inert here.
    if (isNoSkipMfaPolicy(this.mfaSettings.policy)) {
      return hasUserFactors;
    }

    // [NiceMatrix override] explicit opt-in only — see the file header.
    return getUserMfaState(this.mfaSettings, this.user).isEnabled;
  }

  isMfaVerified(verificationRecords: VerificationRecord[]) {
    return this.getVerifiedMfaVerificationRecords(verificationRecords).length > 0;
  }

  hasEligibleTrustedDeviceVerification(
    verificationRecords: VerificationRecord[],
    currentProfile?: InteractionProfile
  ) {
    return this.getVerifiedMfaVerificationRecords(verificationRecords, currentProfile).some(
      ({ type }) => type !== VerificationType.BackupCode
    );
  }

  private getVerifiedMfaVerificationRecords(
    verificationRecords: VerificationRecord[],
    currentProfile?: InteractionProfile
  ) {
    const userEnabledMfaVerifications = getAllUserEnabledMfaVerifications(
      this.mfaSettings,
      this.user,
      currentProfile
    );

    return verificationRecords.filter(
      (verification) =>
        isMfaVerificationRecord(verification) &&
        verification.isVerified &&
        // New bind MFA verification can not be used for verification
        !verification.isNewBindMfaVerification &&
        // Check if the verification type is enabled in the user's MFA settings
        userEnabledMfaVerifications.includes(mfaVerificationTypeToMfaFactorMap[verification.type])
    );
  }
}
