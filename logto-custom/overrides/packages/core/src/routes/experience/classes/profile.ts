/*
 * [NiceMatrix override] vs upstream 1.43.0
 *   logto-upstream/packages/core/src/routes/experience/classes/profile.ts
 * Carrier one-tap sign-up may skip profile completion (review 2026-10-02 CR-14 / B7,
 * decision: "prompt, but allow skipping"). Three deltas, all marked `[NiceMatrix override]`:
 *   1. `canSkipForCarrier` / `markCarrierProfileSkipped()` — the ONLY writer of
 *      `carrierProfileSkipped` (called by routes/carrier-profile-skip-routes.ts);
 *   2. `assertUserMandatoryProfileFulfilled()` returns early for a Register
 *      interaction whose user chose skip AND whose social identity is carrier
 *      (or whose user this interaction already created from it);
 *   3. `cleanUp()` keeps the flag, so `submit()` (which re-asserts) agrees with
 *      `createUser()`.
 * Sign-in of existing users, SMS / password / other social sign-ups and the
 * tenant-wide `skipRequiredIdentifiers` are untouched.
 * On upstream sync re-copy the file and re-apply the marked blocks only.
 */
import {
  InteractionEvent,
  MissingProfile,
  SignInIdentifier,
  type UpdateProfileApiPayload,
  VerificationType,
} from '@logto/schemas';
import { pick, trySafe } from '@silverhand/essentials';

import RequestError from '#src/errors/RequestError/index.js';
import { carrierConnectorTarget } from '#src/libraries/carrier-launch-context.js';
import { type LogEntry } from '#src/middleware/koa-audit-log.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';
import { assertUsernameAllowed } from '#src/utils/user.js';

import type {
  SanitizedInteractionProfile,
  InteractionContext,
  InteractionProfile,
} from '../types.js';

import { PasswordValidator } from './libraries/password-validator.js';
import { ProfileValidator } from './libraries/profile-validator.js';
import { SignInExperienceValidator } from './libraries/sign-in-experience-validator.js';

// Supported profile types for setting the profile data through the verification record.
type SetProfileByVerificationIdType = Exclude<
  UpdateProfileApiPayload['type'],
  'password' | SignInIdentifier.Username | 'extraProfile'
>;

export class Profile {
  readonly profileValidator: ProfileValidator;
  private readonly signInExperienceValidator: SignInExperienceValidator;
  #data: InteractionProfile;

  constructor(
    private readonly libraries: Libraries,
    queries: Queries,
    data: InteractionProfile,
    private readonly interactionContext: InteractionContext
  ) {
    this.signInExperienceValidator = new SignInExperienceValidator(libraries, queries);
    this.profileValidator = new ProfileValidator(queries, this.signInExperienceValidator);
    this.#data = data;
  }

  markProfileSubmitted() {
    this.#data.submitted = true;
  }

  get profileSubmitted() {
    return this.#data.submitted;
  }

  /**
   * [NiceMatrix override] A carrier one-tap sign-up whose user has not been created
   * yet: the only state in which "skip profile completion" may be recorded.
   */
  get canSkipForCarrier(): boolean {
    return (
      this.interactionContext.getInteractionEvent() === InteractionEvent.Register &&
      this.#data.socialIdentity?.target === carrierConnectorTarget
    );
  }

  /** [NiceMatrix override] Record the user's "skip" (see `canSkipForCarrier`). */
  markCarrierProfileSkipped() {
    assertThat(
      this.canSkipForCarrier,
      new RequestError({ code: 'session.invalid_interaction_type', status: 400 })
    );
    this.#data.carrierProfileSkipped = true;
  }

  get data() {
    return this.#data;
  }

  get sanitizedData(): SanitizedInteractionProfile {
    return pick(
      this.#data,
      'avatar',
      'name',
      'username',
      'primaryEmail',
      'primaryPhone',
      'profile',
      'customData',
      'socialIdentity',
      'enterpriseSsoIdentity',
      'jitOrganizationIds',
      'syncedEnterpriseSsoIdentity'
    );
  }

  /**
   * Set the identified email or phone to the profile using the verification record.
   *
   * @throws {RequestError} 404 if the verification record is not found.
   * @throws {RequestError} 422 if the profile data already exists in the current user account.
   * @throws {RequestError} 422 if the unique identifier data already exists in another user account.
   * @throws {RequestError} 422 if the email domain is SSO only.
   */
  async setProfileByVerificationId(
    type: SetProfileByVerificationIdType,
    verificationId: string,
    log?: LogEntry
  ) {
    const verificationRecord = this.interactionContext.getVerificationRecordById(verificationId);

    // Assert the verification record type matches the identifier type
    switch (type) {
      case SignInIdentifier.Email: {
        assertThat(
          verificationRecord.type === VerificationType.EmailVerificationCode,
          new RequestError({ code: 'session.verification_session_not_found', status: 404 })
        );
        break;
      }
      case SignInIdentifier.Phone: {
        assertThat(
          verificationRecord.type === VerificationType.PhoneVerificationCode,
          new RequestError({ code: 'session.verification_session_not_found', status: 404 })
        );
        break;
      }
      case 'social': {
        assertThat(
          verificationRecord.type === VerificationType.Social,
          new RequestError({ code: 'session.verification_session_not_found', status: 404 })
        );
        break;
      }
    }

    // Guard SSO only email identifier in verification record  (EmailVerificationCode, Social)
    await this.signInExperienceValidator.guardSsoOnlyEmailIdentifier(verificationRecord);

    await this.signInExperienceValidator.guardEmailBlocklist(verificationRecord);

    log?.append({
      verification: verificationRecord.toJson(),
    });

    const profile = await verificationRecord.toUserProfile();

    await this.setProfileWithValidation(profile);

    // Sync social user info to the user profile
    if (verificationRecord.type === VerificationType.Social) {
      const user = await this.safeGetIdentifiedUser();
      const isNewUserIdentity = !user;

      // Sync the email and phone to the user profile only for new user identity
      const syncedProfile = await verificationRecord.toSyncedProfile(isNewUserIdentity);
      this.unsafePrepend(syncedProfile);

      // Sync the social connector token set secret to the user profile
      const socialConnectorTokenSetSecret = await verificationRecord.getTokenSetSecret();
      this.unsafePrepend({ socialConnectorTokenSetSecret });
    }
  }

  /**
   * Set the profile data with validation.
   *
   * @throws {RequestError} 422 if the profile data already exists in the current user account. (Existing user profile only)
   * @throws {RequestError} 422 if the unique identifier data already exists in another user account.
   */
  async setProfileWithValidation(profile: InteractionProfile) {
    const user = await this.safeGetIdentifiedUser();

    if (user) {
      this.profileValidator.guardProfileNotExistInCurrentUserAccount(user, profile);
    }

    // Runs before the uniqueness check so a format/policy violation is reported ahead of
    // "username already in use", matching the account and /me routes.
    if (profile.username) {
      assertUsernameAllowed(
        await this.signInExperienceValidator.getUsernamePolicy(),
        profile.username
      );
    }

    await this.profileValidator.guardProfileUniquenessAcrossUsers(profile);

    this.unsafeSet(profile);
  }

  /**
   * Set password with password policy validation.
   *
   * @param reset - If true the password will be set without checking if it already exists in the current user account.
   * @throws {RequestError} 422 if the password does not meet the password policy.
   * @throws {RequestError} 422 if the password is the same as the current user's password. (Existing user profile only)
   */
  async setPasswordDigestWithValidation(password: string, reset = false) {
    const user = await this.safeGetIdentifiedUser();
    const passwordPolicy = await this.signInExperienceValidator.getPasswordPolicy();
    const passwordValidator = new PasswordValidator(passwordPolicy, user);
    await passwordValidator.validatePassword(password, this.#data);
    const passwordDigests = await passwordValidator.createPasswordDigest(password);

    if (user && !reset) {
      this.profileValidator.guardProfileNotExistInCurrentUserAccount(user, passwordDigests);
    }

    this.unsafeSet(passwordDigests);
  }

  /**
   * Verifies the profile data is valid.
   *
   * @throws {RequestError} 422 if the profile data already exists in the current user account. (Existing user profile only)
   * @throws {RequestError} 422 if the unique identifier data already exists in another user account.
   */
  async validateAvailability() {
    const user = await this.safeGetIdentifiedUser();

    if (user) {
      this.profileValidator.guardProfileNotExistInCurrentUserAccount(user, this.#data);
    }

    await this.profileValidator.guardProfileUniquenessAcrossUsers(this.#data);
  }

  /**
   * Checks if the user has fulfilled the mandatory profile fields.
   *
   * @remarks
   * - Skip the check if the profile contains an enterprise SSO identity or the user is verified via SSO.
   * - Skip the check if the profile contains a social identity or the user is verified via social identity and `skipRequiredIdentifiers` is true.
   *
   * @throws {RequestError} 422 if the mandatory profile fields are not fulfilled.
   */
  async assertUserMandatoryProfileFulfilled({
    hasVerifiedSocialIdentity,
    hasVerifiedSsoIdentity,
  }: {
    hasVerifiedSocialIdentity: boolean;
    hasVerifiedSsoIdentity: boolean;
  }) {
    const user = await this.safeGetIdentifiedUser();

    if (this.#data.enterpriseSsoIdentity ?? hasVerifiedSsoIdentity) {
      return;
    }

    // [NiceMatrix override] Carrier sign-up, user chose "skip": do not enforce the
    // remaining sign-up requirements for THIS registration. Before creation the
    // pending profile must still be the carrier one; after `createUser()` the
    // profile was cleaned and the user exists (created from it in this interaction).
    if (
      this.#data.carrierProfileSkipped &&
      this.interactionContext.getInteractionEvent() === InteractionEvent.Register &&
      (this.#data.socialIdentity
        ? this.#data.socialIdentity.target === carrierConnectorTarget
        : Boolean(user))
    ) {
      return;
    }

    if (this.#data.socialIdentity ?? hasVerifiedSocialIdentity) {
      const { skipRequiredIdentifiers } =
        await this.signInExperienceValidator.getSocialSignInPolicy();

      if (skipRequiredIdentifiers) {
        return;
      }
    }

    const mandatoryProfileFields =
      await this.signInExperienceValidator.getMandatoryUserProfileBySignUpMethods();

    const missingMandatoryProfile = this.profileValidator.getMissingUserProfile(
      this.#data,
      mandatoryProfileFields,
      user
    );

    assertThat(
      missingMandatoryProfile.size === 0,
      new RequestError(
        { code: 'user.missing_profile', status: 422 },
        { missingProfile: [...missingMandatoryProfile] }
      )
    );

    assertThat(
      this.interactionContext.getInteractionEvent() !== InteractionEvent.Register ||
        !(await this.profileValidator.hasMissingExtraProfileFields(this.#data, user)),
      new RequestError(
        {
          code: 'user.missing_profile',
          status: 422,
        },
        { missingProfile: [MissingProfile.extraProfile] }
      )
    );
  }

  /**
   * Set profile without validation.
   * - skip profile uniqueness check.
   * - skip profile existence check in the current user account.
   */
  unsafeSet(profile: InteractionProfile) {
    this.#data = {
      ...this.#data,
      ...profile,
    };
  }

  /**
   * Prepend the profile data to the existing profile data.
   * Avoid overwriting the existing profile data.
   */
  unsafePrepend(profile: InteractionProfile) {
    this.#data = {
      ...profile,
      ...this.#data,
    };
  }

  /**
   * Clean up the user related profile data from interaction storage after successfully creating the user,
   * keeping only the `submitted` flag to indicate whether the user has submitted the profile form.
   */
  cleanUp() {
    // [NiceMatrix override] keep the carrier skip so `submit()` agrees with `createUser()`.
    this.#data = pick(this.#data, 'submitted', 'carrierProfileSkipped');
  }

  /**
   * Safely get the identified user from the interaction context.
   * If the interaction event is register, the user will be retrieved safely.
   *
   * @returns The identified user from the interaction context.
   */
  private async safeGetIdentifiedUser() {
    const { getInteractionEvent, getIdentifiedUser } = this.interactionContext;

    const interactionEvent = getInteractionEvent();

    if (interactionEvent === InteractionEvent.Register) {
      return trySafe(async () => getIdentifiedUser());
    }

    return getIdentifiedUser();
  }
}
