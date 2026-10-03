/**
 * [NiceMatrix] profile.ts override — carrier sign-up may skip profile completion
 * (review 2026-10-02 CR-14 / B7). Every other sign-up / sign-in keeps upstream's
 * mandatory-profile enforcement.
 */
import { InteractionEvent, MissingProfile, type User } from '@logto/schemas';

import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

import type { InteractionContext, InteractionProfile } from '../types.js';

import { type SignInExperienceValidator } from './libraries/sign-in-experience-validator.js';
import { Profile } from './profile.js';

const { jest } = import.meta;

const carrierIdentity = { target: 'carrier', userInfo: { id: 'att_1', phone: '8613800138000' } };
const wechatIdentity = { target: 'wechat', userInfo: { id: 'wx_1' } };

const createProfile = ({
  interactionEvent = InteractionEvent.Register,
  data = {},
  user,
}: {
  interactionEvent?: InteractionEvent;
  data?: InteractionProfile;
  user?: Partial<User>;
} = {}) => {
  const interactionContext: InteractionContext = {
    getInteractionEvent: () => interactionEvent,
    getIdentifiedUser: jest.fn(async () => {
      if (!user) {
        throw new Error('not identified');
      }

      return user as User;
    }),
    getVerificationRecordById: () => {
      throw new Error('should not be called');
    },
    getVerificationRecordByTypeAndId: () => {
      throw new Error('should not be called');
    },
    getCurrentProfile: () => data,
    getTrustedDeviceCreationAvailability: jest.fn(async () => undefined),
  };

  const profile = new Profile({} as Libraries, {} as Queries, data, interactionContext);
  const { signInExperienceValidator } = profile as unknown as {
    signInExperienceValidator: SignInExperienceValidator;
  };
  // Production sign-up policy: phone + username + email (verified).
  const getMandatory = jest
    .spyOn(signInExperienceValidator, 'getMandatoryUserProfileBySignUpMethods')
    .mockResolvedValue(new Set([MissingProfile.username, MissingProfile.email]));
  jest
    .spyOn(signInExperienceValidator, 'getSocialSignInPolicy')
    .mockResolvedValue({ skipRequiredIdentifiers: false, automaticAccountLinking: true });

  return { profile, getMandatory };
};

const assertFulfilled = async (profile: Profile) =>
  profile.assertUserMandatoryProfileFulfilled({
    hasVerifiedSocialIdentity: true,
    hasVerifiedSsoIdentity: false,
  });

describe('Profile — carrier sign-up skip', () => {
  it('only a pending carrier sign-up can record the skip', () => {
    expect(createProfile({ data: { socialIdentity: carrierIdentity } }).profile.canSkipForCarrier).toBe(
      true
    );
    expect(
      createProfile({
        interactionEvent: InteractionEvent.SignIn,
        data: { socialIdentity: carrierIdentity },
      }).profile.canSkipForCarrier
    ).toBe(false);
    expect(createProfile({ data: { socialIdentity: wechatIdentity } }).profile.canSkipForCarrier).toBe(
      false
    );
    expect(createProfile({ data: { primaryPhone: '8613800138000' } }).profile.canSkipForCarrier).toBe(
      false
    );
  });

  it('markCarrierProfileSkipped refuses anything else (400) and writes nothing', () => {
    const { profile } = createProfile({ data: { socialIdentity: wechatIdentity } });
    expect(() => {
      profile.markCarrierProfileSkipped();
    }).toThrow(expect.objectContaining({ code: 'session.invalid_interaction_type', status: 400 }));
    expect(profile.data.carrierProfileSkipped).toBeUndefined();
  });

  it('without the skip, a carrier sign-up is still prompted (missing_profile)', async () => {
    const { profile } = createProfile({ data: { socialIdentity: carrierIdentity } });
    await expect(assertFulfilled(profile)).rejects.toMatchObject({
      code: 'user.missing_profile',
    });
  });

  it('after the skip, user creation and the final submit both pass', async () => {
    const { profile, getMandatory } = createProfile({ data: { socialIdentity: carrierIdentity } });
    profile.markCarrierProfileSkipped();
    await expect(assertFulfilled(profile)).resolves.toBeUndefined();

    // createUser() → cleanUp(): the flag survives, the identity is gone, the user exists.
    profile.cleanUp();
    expect(profile.data).toEqual({ carrierProfileSkipped: true });

    const submitted = createProfile({
      data: profile.data,
      user: { id: 'u1', primaryPhone: '8613800138000' },
    });
    await expect(assertFulfilled(submitted.profile)).resolves.toBeUndefined();
    expect(getMandatory).not.toHaveBeenCalled();
    expect(submitted.getMandatory).not.toHaveBeenCalled();
  });

  it('a skip flag never helps a sign-in or another sign-up method', async () => {
    // Sign-in of an existing user: upstream enforcement.
    await expect(
      assertFulfilled(
        createProfile({
          interactionEvent: InteractionEvent.SignIn,
          data: { socialIdentity: carrierIdentity, carrierProfileSkipped: true },
          user: { id: 'u1', primaryPhone: '8613800138000' },
        }).profile
      )
    ).rejects.toMatchObject({ code: 'user.missing_profile' });

    // A pending profile from another connector.
    await expect(
      assertFulfilled(
        createProfile({ data: { socialIdentity: wechatIdentity, carrierProfileSkipped: true } })
          .profile
      )
    ).rejects.toMatchObject({ code: 'user.missing_profile' });

    // No social identity and no created user.
    await expect(
      assertFulfilled(
        createProfile({ data: { primaryPhone: '8613800138000', carrierProfileSkipped: true } })
          .profile
      )
    ).rejects.toMatchObject({ code: 'user.missing_profile' });
  });
});
