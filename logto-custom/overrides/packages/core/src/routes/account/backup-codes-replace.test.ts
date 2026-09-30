/**
 * [NiceMatrix] POST /api/my-account/mfa-verifications/backup-codes/replace (backup-codes-replace.ts).
 */
import { UserScope } from '@logto/core-kit';
import { AccountCenterControlValue, MfaFactor, type User } from '@logto/schemas';
import { createMockUtils, pickDefault } from '@logto/shared/esm';

import {
  mockSignInExperience,
  mockUser,
  mockUserTotpMfaVerification,
} from '#src/__mocks__/index.js';
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

const oldBackupCodes = {
  id: 'old-backup',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: MfaFactor.BackupCode as const,
  codes: [{ code: 'aaaaaaaaaa' }, { code: 'bbbbbbbbbb', usedAt: '2026-02-01T00:00:00.000Z' }],
};
const newCodes = Array.from({ length: 10 }, (_, index) => `abcdef${String(index).padStart(4, '0')}`);

const mockedQueries = {
  users: {
    findUserById: jest.fn(async (): Promise<User> => mockUser),
    updateUserById: jest.fn(async (_userId: string, data: Partial<User>) => ({
      ...mockUser,
      ...data,
    })),
  },
  signInExperiences: {
    findDefaultSignInExperience: jest.fn(async () => ({
      ...mockSignInExperience,
      mfa: { ...mockSignInExperience.mfa, factors: [MfaFactor.TOTP, MfaFactor.BackupCode] },
    })),
  },
} satisfies Partial2<Queries>;
const { findUserById, updateUserById } = mockedQueries.users;
const { findDefaultSignInExperience } = mockedQueries.signInExperiences;

const routes = await pickDefault(import('./backup-codes-replace.js'));

const requesterWith = (identityVerified: boolean) =>
  createRequester({
    middlewares: [koaI18next(), koaErrorHandler()],
    authedRoutes: [
      (router) => {
        router.use(async (ctx, next) => {
          ctx.auth = {
            ...ctx.auth,
            id: mockUser.id,
            identityVerified,
            scopes: new Set([UserScope.Identities]),
          };
          ctx.accountCenter = {
            enabled: true,
            fields: { mfa: AccountCenterControlValue.Edit },
          };
          ctx.appendDataHookContext = jest.fn();
          return next();
        });
      },
      routes as never,
    ],
    tenantContext: new MockTenant(undefined, mockedQueries),
  });

const path = '/my-account/mfa-verifications/backup-codes/replace';

describe('POST /my-account/mfa-verifications/backup-codes/replace', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('swaps the old backup-code factor for the new one in a single write', async () => {
    findUserById.mockResolvedValueOnce({
      ...mockUser,
      mfaVerifications: [mockUserTotpMfaVerification, oldBackupCodes],
    });

    const response = await requesterWith(true).post(path).send({ codes: newCodes });

    expect(response.status).toBe(204);
    expect(updateUserById).toHaveBeenCalledTimes(1);
    const payload = updateUserById.mock.calls[0]?.[1];
    expect(payload).not.toHaveProperty('logtoConfig');
    const factors = payload?.mfaVerifications ?? [];
    expect(factors.filter(({ type }) => type === MfaFactor.BackupCode)).toHaveLength(1);
    expect(factors.some(({ id }) => id === oldBackupCodes.id)).toBe(false);
    expect(factors.some(({ id }) => id === mockUserTotpMfaVerification.id)).toBe(true);
    const added = factors.find(({ type }) => type === MfaFactor.BackupCode);
    expect(added && 'codes' in added ? added.codes.map(({ code }) => code) : []).toEqual(newCodes);
  });

  it('keeps the old codes when identity verification is missing', async () => {
    const response = await requesterWith(false).post(path).send({ codes: newCodes });

    expect(response.status).toBe(401);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses to leave backup codes as the only factor', async () => {
    findUserById.mockResolvedValueOnce({ ...mockUser, mfaVerifications: [oldBackupCodes] });

    const response = await requesterWith(true).post(path).send({ codes: newCodes });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'session.mfa.backup_code_can_not_be_alone' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('rejects malformed codes without touching the user', async () => {
    const response = await requesterWith(true).post(path).send({ codes: ['short'] });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'user.wrong_backup_code_format' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses when backup codes are not an enabled factor', async () => {
    findDefaultSignInExperience.mockResolvedValueOnce({
      ...mockSignInExperience,
      mfa: { ...mockSignInExperience.mfa, factors: [MfaFactor.TOTP] },
    });

    const response = await requesterWith(true).post(path).send({ codes: newCodes });

    expect(response.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
