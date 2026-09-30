/**
 * [NiceMatrix] pure helpers added 2026-09-29: TOTP enrollment URI, Apple authorization capture.
 */
import type { SocialUserInfo } from '@logto/connector-kit';

import {
  captureAppleAuthorization,
  readIdTokenAudience,
  toAppleAuthorizationRow,
} from './apple-authorization-capture.js';
import { buildTotpEnrollment, buildTotpKeyUri } from './totp-key-uri.js';

const { jest } = import.meta;

const jwt = (payload: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('totp-key-uri', () => {
  const user = { username: 'alice', primaryEmail: null, primaryPhone: null, name: null };

  it('uses the brand issuer and the display name', () => {
    const uri = buildTotpKeyUri(user, 'JBSWY3DPEHPK3PXP');
    expect(uri).toBe(
      'otpauth://totp/NiceMatrix%20ID:alice?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&algorithm=SHA1&issuer=NiceMatrix%20ID'
    );
  });

  it('falls back to Unnamed User and returns a PNG data URL', async () => {
    const { otpauthUri, secretQrCode } = await buildTotpEnrollment(
      { username: null, primaryEmail: null, primaryPhone: null, name: null },
      'JBSWY3DPEHPK3PXP'
    );
    expect(otpauthUri).toContain(':Unnamed%20User?');
    expect(secretQrCode.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('apple-authorization-capture', () => {
  const userInfo = (rawData: Record<string, string>): SocialUserInfo => ({
    id: 'apple-sub',
    rawData,
  });

  it('reads the audience (string or first array entry)', () => {
    expect(readIdTokenAudience(jwt({ aud: 'id.nicematrix.com' }))).toBe('id.nicematrix.com');
    expect(readIdTokenAudience(jwt({ aud: ['com.x.app', 'other'] }))).toBe('com.x.app');
    expect(readIdTokenAudience('not-a-jwt')).toBeUndefined();
  });

  it('builds a row only for Apple callbacks carrying a code and an id_token', () => {
    const raw = { code: 'c1', id_token: jwt({ aud: 'id.nicematrix.com' }) };
    expect(toAppleAuthorizationRow('apple', userInfo(raw))).toEqual({
      appleSub: 'apple-sub',
      clientId: 'id.nicematrix.com',
      code: 'c1',
    });
    expect(toAppleAuthorizationRow('google', userInfo(raw))).toBeUndefined();
    expect(toAppleAuthorizationRow('apple', userInfo({ id_token: raw.id_token }))).toBeUndefined();
    expect(toAppleAuthorizationRow('apple', userInfo({ code: 'c1' }))).toBeUndefined();
  });

  it('inserts the row and never throws on a database error', async () => {
    const raw = { code: 'c1', id_token: jwt({ aud: 'id.nicematrix.com' }) };
    const ok = { query: jest.fn(async () => ({ rowCount: 1 })) };
    await captureAppleAuthorization(ok as never, 'apple', userInfo(raw));
    expect(ok.query).toHaveBeenCalledTimes(1);

    const broken = {
      query: jest.fn(async () => {
        throw new Error('relation does not exist');
      }),
    };
    await expect(
      captureAppleAuthorization(broken as never, 'apple', userInfo(raw))
    ).resolves.toBeUndefined();

    const skipped = { query: jest.fn() };
    await captureAppleAuthorization(skipped as never, 'wechat', userInfo(raw));
    expect(skipped.query).not.toHaveBeenCalled();
  });
});
