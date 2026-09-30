/**
 * [NiceMatrix] social step-up in the Account API auth middleware (libraries/social-step-up.ts).
 * A Social verification record sets `identityVerified` only when it is owned by the caller AND its
 * third-party user id is still the caller's linked identity for that connector.
 */
import { VerificationType } from '@logto/schemas';
import { pickDefault } from '@logto/shared/esm';
import type { Context } from 'koa';
import type { IRouterParamContext } from 'koa-router';
import { Provider } from 'oidc-provider';
import Sinon from 'sinon';

import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createContextWithRouteParameters } from '#src/utils/test-utils.js';

import { verificationRecordIdHeader } from './constants.js';
import type { WithAuthContext } from './index.js';

const { jest } = import.meta;

const provider = new Provider('https://logto.test');
const accessToken = { accountId: 'fooUser', clientId: 'fooClient', scopes: new Set(['openid']) };
const koaOidcAuth = await pickDefault(import('./koa-oidc-auth.js'));

const socialRecord = (providerUserId?: string) => ({
  type: VerificationType.Social,
  connectorId: 'apple-connector',
  ...(providerUserId && { socialUserInfo: { id: providerUserId } }),
});

const tenantWith = ({
  data,
  recordOwner = accessToken.accountId,
  linkedAppleId = 'apple-sub-1',
  target = 'apple',
}: {
  data: Record<string, unknown>;
  recordOwner?: string;
  linkedAppleId?: string;
  target?: string;
}) =>
  new MockTenant(
    provider,
    {
      verificationRecords: {
        findActiveVerificationRecordById: jest.fn(async (id: string) => ({
          id,
          userId: recordOwner,
          data,
          expiresAt: Date.now() + 60_000,
        })),
      },
      users: {
        findUserById: jest.fn(async () => ({
          id: accessToken.accountId,
          identities: linkedAppleId ? { apple: { userId: linkedAppleId, details: {} } } : {},
        })),
      },
    } as unknown as Partial2<Queries>,
    undefined,
    {
      socials: { getConnector: jest.fn(async () => ({ metadata: { target } })) },
    } as unknown as Partial2<Libraries>
  );

describe('koaOidcAuth — NiceMatrix social step-up', () => {
  const baseCtx = createContextWithRouteParameters();
  const ctx: WithAuthContext<Context & IRouterParamContext> = {
    ...baseCtx,
    auth: { type: 'user', id: '', scopes: new Set() },
  };
  const next = jest.fn();

  beforeEach(() => {
    ctx.request = {
      ...baseCtx.request,
      headers: { authorization: 'Bearer token', [verificationRecordIdHeader]: 'record-1' },
    };
    Sinon.stub(provider.AccessToken, 'find').resolves(accessToken);
  });

  afterEach(() => {
    Sinon.restore();
  });

  it('accepts a caller-owned social record matching the linked identity', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord('apple-sub-1') }))(ctx, next);
    expect(ctx.auth.identityVerified).toBe(true);
  });

  it('rejects a record completed with a different third-party account', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord('apple-sub-attacker') }))(ctx, next);
    expect(ctx.auth.identityVerified).toBe(false);
  });

  it('rejects a record once the identity is no longer linked', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord('apple-sub-1'), linkedAppleId: '' }))(
      ctx,
      next
    );
    expect(ctx.auth.identityVerified).toBe(false);
  });

  it('rejects a record when the connector maps to another target', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord('apple-sub-1'), target: 'google' }))(
      ctx,
      next
    );
    expect(ctx.auth.identityVerified).toBe(false);
  });

  it('rejects an unverified social record', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord() }))(ctx, next);
    expect(ctx.auth.identityVerified).toBe(false);
  });

  it('rejects a social record owned by someone else (or by nobody, as upstream creates)', async () => {
    await koaOidcAuth(tenantWith({ data: socialRecord('apple-sub-1'), recordOwner: 'other' }))(
      ctx,
      next
    );
    expect(ctx.auth.identityVerified).toBe(false);
  });
});
