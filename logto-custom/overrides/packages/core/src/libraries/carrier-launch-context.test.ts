/**
 * [NiceMatrix] carrier-launch-context.ts — the launch context the cn Broker verifies
 * (backend apps/api/src/modules/carrier-auth/launch-context.js).
 */
import { createHash } from 'node:crypto';

import { decodeProtectedHeader, jwtVerify } from 'jose';

import { buildCarrierLaunchContext, carrierLaunchKeyId } from './carrier-launch-context.js';

const { jest } = import.meta;

const key = 'L'.repeat(48);
const params = {
  client_id: 'client-1',
  app_slug: 'nicenote',
  region: 'cn',
  device_ref: 'device-1',
  carrier_mode: 'h5',
  carrier_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  unrelated: 'never copied',
};

describe('buildCarrierLaunchContext', () => {
  it('signs HS256 with typ/kid and exactly the documented claims', async () => {
    const token = await buildCarrierLaunchContext({
      jti: 'interaction-jti',
      params,
      state: 'se_state',
      redirectUri: 'https://id.nicematrix.com/callback/c1',
      key,
    });
    const header = decodeProtectedHeader(token);
    expect(header).toEqual({ alg: 'HS256', typ: 'nmx-carrier-launch+jwt', kid: carrierLaunchKeyId(key) });

    const { payload } = await jwtVerify(token, Buffer.from(key), {
      audience: 'nmx-carrier-broker',
      typ: 'nmx-carrier-launch+jwt',
    });
    expect(payload).toMatchObject({
      ixh: createHash('sha256').update('interaction-jti').digest('base64url'),
      state: 'se_state',
      redirect_uri: 'https://id.nicematrix.com/callback/c1',
      client_id: 'client-1',
      app_slug: 'nicenote',
      region: 'cn',
      device_ref: 'device-1',
      carrier_mode: 'h5',
      carrier_challenge: params.carrier_challenge,
    });
    expect(payload).not.toHaveProperty('unrelated');
    expect(JSON.stringify(payload)).not.toContain('interaction-jti');
    expect(payload.exp! - payload.iat!).toBe(60);
    expect(typeof payload.jti).toBe('string');
  });

  it('omits an absent device_ref / app_version', async () => {
    const { device_ref: _omit, ...rest } = params;
    const token = await buildCarrierLaunchContext({ jti: 'j', params: rest, state: 's', redirectUri: 'r', key });
    const { payload } = await jwtVerify(token, Buffer.from(key), { audience: 'nmx-carrier-broker' });
    expect(payload).not.toHaveProperty('device_ref');
    expect(payload).not.toHaveProperty('app_version');
  });

  it('signs a declared app_version and drops a malformed one (review CR-07)', async () => {
    const sign = async (appVersion: string) => {
      const token = await buildCarrierLaunchContext({
        jti: 'j',
        params: { ...params, app_version: appVersion },
        state: 's',
        redirectUri: 'r',
        key,
      });
      return (await jwtVerify(token, Buffer.from(key), { audience: 'nmx-carrier-broker' })).payload;
    };

    expect(await sign('2.1.0')).toMatchObject({ app_version: '2.1.0' });
    expect(await sign('1.2.3-beta.1+ci42')).toMatchObject({ app_version: '1.2.3-beta.1+ci42' });
    expect(await sign('<script>')).not.toHaveProperty('app_version');
    expect(await sign('1'.repeat(65))).not.toHaveProperty('app_version');
  });

  const expectUnavailable = async (input: Record<string, unknown>, keyValue = key) => {
    const error: unknown = await buildCarrierLaunchContext({
      jti: 'j',
      params: input,
      state: 's',
      redirectUri: 'r',
      key: keyValue,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'connector.not_enabled', status: 400, data: { carrier: 'not_supported' } });
  };

  it('refuses without a key with the carrier "unavailable" error (no raw 500)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expectUnavailable(params, '');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH'));
    spy.mockRestore();
  });

  it('refuses a sign-in without client_id / app_slug / region (review CR-17)', async () => {
    for (const missing of ['client_id', 'app_slug', 'region'] as const) {
      const { [missing]: _drop, ...rest } = params;
      // eslint-disable-next-line no-await-in-loop
      await expectUnavailable(rest);
    }
  });

  it('refuses an absent / invalid carrier_mode or carrier_challenge', async () => {
    for (const patch of [
      { carrier_mode: undefined },
      { carrier_mode: 'sms' },
      { carrier_challenge: undefined },
      { carrier_challenge: 'short' },
      { carrier_challenge: `${params.carrier_challenge}x` },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await expectUnavailable({ ...params, ...patch });
    }
  });
});
