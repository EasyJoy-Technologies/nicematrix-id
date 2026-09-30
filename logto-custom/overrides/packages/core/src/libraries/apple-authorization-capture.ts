/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * Sign in with Apple token revocation (App Store guideline 5.1.1(v)): when an account is deleted
 * the app must revoke its Apple tokens via `https://appleid.apple.com/auth/revoke`. Revocation needs a
 * refresh_token, which only comes from exchanging the one-time authorization `code` Apple posts back
 * on every authorization. Upstream's Apple connector verifies the `id_token` and drops the code.
 *
 * This records `(apple sub, client id, code)` in `nicematrix_apple_authorization_codes`
 * (nicematrix-id sql/20260929_apple_authorization_codes.sql) right after the connector has verified
 * the callback. NiceMatrix Backend on prod-1 (`apple-siwa/`) exchanges the code within its 5-minute
 * validity using the Sign in with Apple key it holds, stores the refresh_token encrypted, and
 * deletes the row. Logto holds no Apple key.
 *
 * Best-effort by design: a failure here is logged and never affects sign-in. The `id_token` is not
 * stored (it carries the user's email); only its `aud` (the Services ID / bundle id that selects the
 * signing key) is read — the connector has already verified the token's signature and audience.
 */
import type { SocialUserInfo } from '@logto/connector-kit';
import { sql, type CommonQueryMethods } from '@silverhand/slonik';

export const appleConnectorTarget = 'apple';

type AppleCallbackRaw = { code?: unknown; id_token?: unknown };

/** `aud` of an already-verified id_token (first entry when it is an array). */
export const readIdTokenAudience = (idToken: string): string | undefined => {
  const payload = idToken.split('.')[1];
  if (!payload) {
    return undefined;
  }
  try {
    // eslint-disable-next-line no-restricted-syntax -- JWT payload is a JSON object
    const { aud } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      aud?: unknown;
    };
    const first: unknown = Array.isArray(aud) ? aud[0] : aud;
    return typeof first === 'string' && first ? first : undefined;
  } catch {
    return undefined;
  }
};

/** Pure: the row to record, or undefined when the callback carries nothing usable. */
export const toAppleAuthorizationRow = (
  target: string,
  userInfo: SocialUserInfo
): { appleSub: string; clientId: string; code: string } | undefined => {
  if (target !== appleConnectorTarget || !userInfo.id) {
    return undefined;
  }
  // eslint-disable-next-line no-restricted-syntax -- connector stores the raw callback payload
  const raw = (userInfo.rawData ?? {}) as AppleCallbackRaw;
  if (typeof raw.code !== 'string' || !raw.code || typeof raw.id_token !== 'string') {
    return undefined;
  }
  const clientId = readIdTokenAudience(raw.id_token);
  return clientId ? { appleSub: userInfo.id, clientId, code: raw.code } : undefined;
};

export const captureAppleAuthorization = async (
  pool: CommonQueryMethods,
  target: string,
  userInfo: SocialUserInfo
): Promise<void> => {
  const row = toAppleAuthorizationRow(target, userInfo);
  if (!row) {
    return;
  }
  try {
    await pool.query(sql`
      insert into nicematrix_apple_authorization_codes (apple_sub, client_id, code)
      values (${row.appleSub}, ${row.clientId}, ${row.code})
      on conflict (code) do nothing
    `);
  } catch (error: unknown) {
    console.error('[nicematrix] apple authorization capture failed:', String(error));
  }
};
