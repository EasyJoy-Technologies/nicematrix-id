/**
 * [NiceMatrix] koa-carrier-login-prompt.ts — server-side `prompt=login` for carrier
 * sign-ins (review 2026-10-02 CR-02).
 */
import createMockContext from '#src/test-utils/jest-koa-mocks/create-mock-context.js';

import koaCarrierLoginPrompt, { carrierLoginPrompt } from './koa-carrier-login-prompt.js';

const { jest } = import.meta;

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const carrier = { carrier_mode: 'native', carrier_challenge: challenge };

describe('carrierLoginPrompt', () => {
  it('appends login and keeps the client values', () => {
    expect(carrierLoginPrompt({ ...carrier, prompt: 'consent' })).toBe('consent login');
    expect(carrierLoginPrompt({ ...carrier })).toBe('login');
    expect(carrierLoginPrompt({ ...carrier, prompt: '' })).toBe('login');
    expect(carrierLoginPrompt({ ...carrier, carrier_mode: 'h5', prompt: 'consent' })).toBe(
      'consent login'
    );
  });

  it('never duplicates login', () => {
    expect(carrierLoginPrompt({ ...carrier, prompt: 'login consent' })).toBeUndefined();
    expect(carrierLoginPrompt({ ...carrier, prompt: 'consent login' })).toBeUndefined();
  });

  it('leaves prompt=none to be rejected by the provider (none must stand alone)', () => {
    expect(carrierLoginPrompt({ ...carrier, prompt: 'none' })).toBe('none login');
  });

  it('ignores requests without a valid carrier declaration', () => {
    expect(carrierLoginPrompt({ prompt: 'consent' })).toBeUndefined();
    expect(carrierLoginPrompt({ carrier_mode: 'native' })).toBeUndefined();
    expect(carrierLoginPrompt({ carrier_mode: 'sms', carrier_challenge: challenge })).toBeUndefined();
    expect(carrierLoginPrompt({ carrier_mode: 'native', carrier_challenge: 'short' })).toBeUndefined();
    expect(
      carrierLoginPrompt({ carrier_mode: ['native', 'h5'], carrier_challenge: challenge })
    ).toBeUndefined();
  });

  it('does not touch a repeated prompt (the provider rejects duplicates)', () => {
    expect(carrierLoginPrompt({ ...carrier, prompt: ['consent', 'login'] })).toBeUndefined();
  });
});

describe('koaCarrierLoginPrompt()', () => {
  const run = async (url: string, method: 'GET' | 'POST' = 'GET') => {
    const ctx = createMockContext({ url, method });
    const next = jest.fn();
    await koaCarrierLoginPrompt()(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);

    return ctx;
  };

  it('rewrites the authorization request', async () => {
    const ctx = await run(
      `/auth?client_id=c&prompt=consent&carrier_mode=native&carrier_challenge=${challenge}&app_slug=nicenote`
    );
    expect(ctx.request.query).toMatchObject({
      client_id: 'c',
      prompt: 'consent login',
      carrier_mode: 'native',
      carrier_challenge: challenge,
      app_slug: 'nicenote',
    });
    expect(new URLSearchParams(ctx.querystring).get('prompt')).toBe('consent login');
  });

  it('leaves every other request byte-identical', async () => {
    for (const [url, method] of [
      ['/auth?client_id=c&prompt=consent', 'GET'],
      [`/auth/uid-1?carrier_mode=native&carrier_challenge=${challenge}`, 'GET'],
      [`/token?carrier_mode=native&carrier_challenge=${challenge}`, 'GET'],
      [`/auth?carrier_mode=native&carrier_challenge=${challenge}`, 'POST'],
    ] as const) {
      const before = url.split('?')[1];
      // eslint-disable-next-line no-await-in-loop
      const ctx = await run(url, method);
      expect(ctx.querystring).toBe(before);
    }
  });
});
