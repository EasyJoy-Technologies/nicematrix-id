/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * One builder for the TOTP enrollment payload shown to an authenticator app, shared by the
 * sign-in experience binding (`routes/experience/classes/verifications/totp-verification.ts`)
 * and the Account API secret generator (`routes/account/mfa-verifications.ts`), so both
 * produce the same `otpauth://` URI:
 *   - issuer  = `mfaIssuerName` (brand name, see constants/mfa-issuer.ts);
 *   - account = the user's display name (username / email / phone / name), else 'Unnamed User'.
 * `secretQrCode` is the same `data:image/png;base64,...` data URL the sign-in flow returns.
 */
import { type User } from '@logto/schemas';
import { getUserDisplayName } from '@logto/shared';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';

import { mfaIssuerName } from '#src/constants/mfa-issuer.js';

export const defaultTotpDisplayName = 'Unnamed User';

type DisplayNameSource = Pick<User, 'username' | 'primaryEmail' | 'primaryPhone' | 'name'>;

export const buildTotpKeyUri = (user: DisplayNameSource, secret: string): string =>
  authenticator.keyuri(
    getUserDisplayName(user) ?? defaultTotpDisplayName,
    mfaIssuerName,
    secret
  );

export const buildTotpEnrollment = async (
  user: DisplayNameSource,
  secret: string
): Promise<{ otpauthUri: string; secretQrCode: string }> => {
  const otpauthUri = buildTotpKeyUri(user, secret);
  return { otpauthUri, secretQrCode: await qrcode.toDataURL(otpauthUri) };
};
