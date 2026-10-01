/**
 * [NiceMatrix] Carrier one-tap login (本机号码一键登录) — launch context signer.
 *
 * NiceMatrix-owned module (no upstream counterpart). Called by the
 * `social-verification.ts` override when the Carrier Connector (target
 * `carrier`) builds its authorization URL. The context is built from the
 * SERVER-SIDE OIDC interaction (never from browser input), so the cn Broker can
 * trust which App / client / device / challenge the sign-in belongs to.
 *
 *   header  alg=HS256, typ=nmx-carrier-launch+jwt, kid=sha256(key)[0..8]
 *   claims  aud=nmx-carrier-broker, ixh=b64url(sha256(interaction jti)), state,
 *           redirect_uri, client_id, app_slug, region, device_ref?, carrier_mode,
 *           carrier_challenge, iat, exp=iat+60, jti (one-time)
 *
 * Key: INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH (container env, shared ONLY with
 * the cn Backend; never the cn↔intl shared key). Missing key → throws, so the
 * Experience falls back to the ordinary sign-in page.
 * Plan: nicematrix-backend docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md §5.3.
 */
import { createHash, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

export const carrierConnectorTarget = 'carrier';

const launchKeyEnv = 'INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH';
const lifetimeSeconds = 60;

export const carrierLaunchKeyId = (key: string) =>
  createHash('sha256').update(key).digest('hex').slice(0, 8);

const stringParam = (params: Record<string, unknown>, key: string): string | undefined => {
  const value = params[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

type LaunchContextInput = {
  /** `provider.interactionDetails().jti` — hashed, never sent raw. */
  jti: string;
  /** `provider.interactionDetails().params` (registered ExtraParams included). */
  params: Record<string, unknown>;
  state: string;
  redirectUri: string;
  now?: Date;
  key?: string;
};

export const buildCarrierLaunchContext = async ({
  jti,
  params,
  state,
  redirectUri,
  now = new Date(),
  key = (process.env[launchKeyEnv] ?? '').trim(),
}: LaunchContextInput): Promise<string> => {
  if (!key) {
    throw new Error(`${launchKeyEnv} is not configured`);
  }

  const iat = Math.floor(now.getTime() / 1000);
  const deviceRef = stringParam(params, 'device_ref');

  return new SignJWT({
    ixh: createHash('sha256').update(jti).digest('base64url'),
    state,
    redirect_uri: redirectUri,
    client_id: stringParam(params, 'client_id'),
    app_slug: stringParam(params, 'app_slug'),
    region: stringParam(params, 'region'),
    ...(deviceRef && { device_ref: deviceRef }),
    carrier_mode: stringParam(params, 'carrier_mode'),
    carrier_challenge: stringParam(params, 'carrier_challenge'),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'nmx-carrier-launch+jwt', kid: carrierLaunchKeyId(key) })
    .setAudience('nmx-carrier-broker')
    .setIssuedAt(iat)
    .setExpirationTime(iat + lifetimeSeconds)
    .setJti(randomUUID())
    .sign(Buffer.from(key, 'utf8'));
};
