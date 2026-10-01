/**
 * [NiceMatrix] carrier-launch-context.ts — the launch context the cn Broker verifies
 * (backend apps/api/src/modules/carrier-auth/launch-context.js).
 */
import { createHash } from 'node:crypto';

import { decodeProtectedHeader, jwtVerify } from 'jose';

import { buildCarrierLaunchContext, carrierLaunchKeyId } from './carrier-launch-context.js';

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

  it('omits an absent device_ref and refuses without a key', async () => {
    const { device_ref: _omit, ...rest } = params;
    const token = await buildCarrierLaunchContext({ jti: 'j', params: rest, state: 's', redirectUri: 'r', key });
    const { payload } = await jwtVerify(token, Buffer.from(key), { audience: 'nmx-carrier-broker' });
    expect(payload).not.toHaveProperty('device_ref');

    await expect(
      buildCarrierLaunchContext({ jti: 'j', params, state: 's', redirectUri: 'r', key: '' })
    ).rejects.toThrow('INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH');
  });
});
