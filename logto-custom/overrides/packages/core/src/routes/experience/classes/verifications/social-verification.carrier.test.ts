/**
 * [NiceMatrix] social-verification.ts override — carrier sign-ups never lose
 * their phone number (review 2026-10-02 CR-03 / CR-18).
 */
import { ConnectorType } from '@logto/connector-kit';
import { VerificationType, type SocialVerificationRecordData } from '@logto/schemas';

import { mockConnector } from '#src/__mocks__/connector.js';
import { MockTenant } from '#src/test-utils/tenant.js';

const { jest } = import.meta;

const hasUserWithNormalizedPhone = jest.fn();
const hasUserWithEmail = jest.fn();
const getConnector = jest.fn();

const tenant = new MockTenant(
  undefined,
  { users: { hasUserWithNormalizedPhone, hasUserWithEmail } },
  undefined,
  { socials: { getConnector } }
);

const { SocialVerification } = await import('./social-verification.js');

const record = (phone?: string, email?: string) =>
  new SocialVerification(tenant.libraries, tenant.queries, {
    id: 'v1',
    connectorId: 'c1',
    type: VerificationType.Social,
    socialUserInfo: { id: 'att_1', ...(phone && { phone }), ...(email && { email }) },
  } as SocialVerificationRecordData);

const connectorWithTarget = (target: string) => ({
  ...mockConnector,
  type: ConnectorType.Social,
  metadata: { ...mockConnector.metadata, target },
});

describe('SocialVerification.toSyncedProfile (carrier override)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasUserWithEmail.mockResolvedValue(false);
  });

  it('carrier + new user + number already owned → 422 user.phone_already_in_use', async () => {
    hasUserWithNormalizedPhone.mockResolvedValue(true);
    getConnector.mockResolvedValue(connectorWithTarget('carrier'));

    await expect(record('8613800138000').toSyncedProfile(true)).rejects.toMatchObject({
      code: 'user.phone_already_in_use',
      status: 422,
    });
  });

  it('carrier + new user + free number → the number is synced', async () => {
    hasUserWithNormalizedPhone.mockResolvedValue(false);
    getConnector.mockResolvedValue(connectorWithTarget('carrier'));

    await expect(record('8613800138000').toSyncedProfile(true)).resolves.toEqual({
      primaryPhone: '8613800138000',
    });
    expect(hasUserWithNormalizedPhone).toHaveBeenCalledTimes(1);
  });

  it('other connectors keep upstream behaviour: a taken number is dropped silently', async () => {
    hasUserWithNormalizedPhone.mockResolvedValue(true);
    getConnector.mockResolvedValue(connectorWithTarget('wechat'));

    await expect(record('8613800138000', 'a@b.c').toSyncedProfile(true)).resolves.toEqual({
      primaryEmail: 'a@b.c',
    });
    expect(hasUserWithNormalizedPhone).toHaveBeenCalledTimes(1);
  });

  it('existing users (isNewUser = false) are unaffected', async () => {
    getConnector.mockResolvedValue({
      ...connectorWithTarget('carrier'),
      dbEntry: { ...mockConnector, syncProfile: false },
    });

    await expect(record('8613800138000').toSyncedProfile(false)).resolves.toEqual({});
    expect(hasUserWithNormalizedPhone).not.toHaveBeenCalled();
  });
});
