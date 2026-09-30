/**
 * [NiceMatrix] /api/my-account/verifications/social{,/verify} (social-step-up.ts).
 */
import { VerificationType, type User } from '@logto/schemas';
import { createMockUtils, pickDefault } from '@logto/shared/esm';

import { mockUser } from '#src/__mocks__/index.js';
import type Libraries from '#src/tenants/Libraries.js';
import koaErrorHandler from '#src/middleware/koa-error-handler.js';
import koaI18next from '#src/middleware/koa-i18next.js';
import type Queries from '#src/tenants/Queries.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);

await mockEsmWithActual('#src/utils/assert-first-party-client.js', () => ({
  assertFirstPartyClient: jest.fn(async () => undefined),
}));

const insertVerificationRecord = jest.fn(async () => ({ expiresAt: Date.now() + 600_000 }));
const updateVerificationRecord = jest.fn(async () => undefined);
const verifyMock = jest.fn();
const recordState: { socialUserInfo?: { id: string } } = {};

await mockEsmWithActual('#src/libraries/verification.js', () => ({
  insertVerificationRecord,
  updateVerificationRecord,
  buildVerificationRecordByIdAndType: jest.fn(async () => ({
    type: VerificationType.Social,
    connectorId: 'apple-connector',
    get socialUserInfo() {
      return recordState.socialUserInfo;
    },
    verify: verifyMock,
  })),
}));

await mockEsmWithActual(
  '#src/routes/experience/classes/verifications/social-verification.js',
  () => ({
    SocialVerification: {
      create: jest.fn(() => ({
        id: 'new-record',
        createAuthorizationUrl: jest.fn(async () => 'https://appleid.apple.com/auth/authorize?x'),
      })),
    },
  })
);

const linkedUser: User = {
  ...mockUser,
  identities: { apple: { userId: 'apple-sub-1', details: {} } },
};

const mockedQueries = {
  users: { findUserById: jest.fn(async (): Promise<User> => linkedUser) },
  verificationRecords: {
    findActiveVerificationRecordById: jest.fn(async (): Promise<unknown> => ({
      id: 'rec',
      userId: mockUser.id,
    })),
  },
} as unknown as Partial2<Queries>;

const routes = await pickDefault(import('./social-step-up.js'));

const request = createRequester({
  middlewares: [koaI18next(), koaErrorHandler()],
  authedRoutes: [
    (router) => {
      router.use(async (ctx, next) => {
        ctx.auth = { ...ctx.auth, id: mockUser.id };
        return next();
      });
    },
    routes as never,
  ],
  tenantContext: new MockTenant(undefined, mockedQueries, undefined, {
    socials: { getConnector: jest.fn(async () => ({ metadata: { target: 'apple' } })) },
  } as unknown as Partial2<Libraries>),
});

const { findUserById } = mockedQueries.users as { findUserById: jest.Mock };
const { findActiveVerificationRecordById } = mockedQueries.verificationRecords as {
  findActiveVerificationRecordById: jest.Mock;
};

describe('social step-up routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    recordState.socialUserInfo = undefined;
  });

  it('creates a record bound to the caller for a linked connector', async () => {
    const response = await request
      .post('/my-account/verifications/social')
      .send({ connectorId: 'apple-connector', state: 's', redirectUri: 'https://x.test/cb' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ verificationRecordId: 'new-record' });
    expect(insertVerificationRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      mockUser.id
    );
  });

  it('refuses a connector the caller has not linked', async () => {
    findUserById.mockResolvedValueOnce({ ...mockUser, identities: {} });

    const response = await request
      .post('/my-account/verifications/social')
      .send({ connectorId: 'apple-connector', state: 's', redirectUri: 'https://x.test/cb' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'user.identity_not_exists_in_current_user' });
    expect(insertVerificationRecord).not.toHaveBeenCalled();
  });

  it('verifies when the authorized account is the linked one', async () => {
    recordState.socialUserInfo = { id: 'apple-sub-1' };

    const response = await request
      .post('/my-account/verifications/social/verify')
      .send({ verificationRecordId: 'rec', connectorData: { code: 'c' } });

    expect(response.status).toBe(200);
    expect(updateVerificationRecord).toHaveBeenCalledTimes(1);
  });

  it('does not mark the record verified for a different third-party account', async () => {
    recordState.socialUserInfo = { id: 'apple-sub-attacker' };

    const response = await request
      .post('/my-account/verifications/social/verify')
      .send({ verificationRecordId: 'rec', connectorData: { code: 'c' } });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'user.social_identity_mismatch' });
    expect(updateVerificationRecord).not.toHaveBeenCalled();
  });

  it("refuses to complete another user's (or an unbound) record", async () => {
    findActiveVerificationRecordById.mockResolvedValueOnce({ id: 'rec', userId: 'someone-else' });

    const response = await request
      .post('/my-account/verifications/social/verify')
      .send({ verificationRecordId: 'rec', connectorData: { code: 'c' } });

    expect(response.status).toBe(404);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('refuses an expired record (no active row)', async () => {
    findActiveVerificationRecordById.mockResolvedValueOnce(null);

    const response = await request
      .post('/my-account/verifications/social/verify')
      .send({ verificationRecordId: 'rec', connectorData: { code: 'c' } });

    expect(response.status).toBe(404);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
