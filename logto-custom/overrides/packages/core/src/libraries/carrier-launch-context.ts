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
 *           redirect_uri, client_id, app_slug, region, device_ref?, app_version?,
 *           carrier_mode, carrier_challenge, iat, exp=iat+60, jti (one-time)
 *
 * Key: INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH (container env, shared ONLY with
 * the cn Backend; never the cn↔intl shared key).
 *
 * Anything this sign-in cannot be served with — no key, or the authorize request
 * lacks client_id / app_slug / region / a valid carrier_mode + carrier_challenge —
 * throws `carrierUnavailableError()` (`connector.not_enabled`, 400). The
 * Experience treats exactly that code as "this sign-in has no carrier login":
 * no toast, back to the ordinary sign-in page (review 2026-10-02 CR-17).
 * Plan: nicematrix-backend docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md §5.3.
 */
import { createHash, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

import RequestError from '#src/errors/RequestError/index.js';

export const carrierConnectorTarget = 'carrier';

const launchKeyEnv = 'INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH';
const lifetimeSeconds = 60;
const carrierModes = new Set(['h5', 'native']);
const challengePattern = /^[\w-]{43}$/;
// The cn Backend owns the version grammar (`normalizeAppVersion`); here only a
// bounded, harmless token is forwarded — anything else is dropped (= undeclared).
const appVersionPattern = /^[\w.+-]{1,64}$/;

/** The one error the Experience maps to a silent "no carrier for this sign-in". */
export const carrierUnavailableError = (reason: string) =>
  new RequestError(
    { code: 'connector.not_enabled', status: 400 },
    { carrier: 'not_supported', reason }
  );

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
    // Ops misconfiguration, not a client error: leave a trace in the container log.
    console.error(`[nicematrix] ${launchKeyEnv} is not configured; carrier sign-in unavailable`);
    throw carrierUnavailableError('launch_key_missing');
  }

  const clientId = stringParam(params, 'client_id');
  const appSlug = stringParam(params, 'app_slug');
  const region = stringParam(params, 'region');
  const carrierMode = stringParam(params, 'carrier_mode');
  const carrierChallenge = stringParam(params, 'carrier_challenge');

  if (!clientId || !appSlug || !region) {
    throw carrierUnavailableError('app_context_missing');
  }

  if (
    !carrierMode ||
    !carrierModes.has(carrierMode) ||
    !carrierChallenge ||
    !challengePattern.test(carrierChallenge)
  ) {
    throw carrierUnavailableError('carrier_params_invalid');
  }

  const iat = Math.floor(now.getTime() / 1000);
  const deviceRef = stringParam(params, 'device_ref');
  const appVersion = stringParam(params, 'app_version');

  return new SignJWT({
    ixh: createHash('sha256').update(jti).digest('base64url'),
    state,
    redirect_uri: redirectUri,
    client_id: clientId,
    app_slug: appSlug,
    region,
    ...(deviceRef && { device_ref: deviceRef }),
    ...(appVersion && appVersionPattern.test(appVersion) && { app_version: appVersion }),
    carrier_mode: carrierMode,
    carrier_challenge: carrierChallenge,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'nmx-carrier-launch+jwt', kid: carrierLaunchKeyId(key) })
    .setAudience('nmx-carrier-broker')
    .setIssuedAt(iat)
    .setExpirationTime(iat + lifetimeSeconds)
    .setJti(randomUUID())
    .sign(Buffer.from(key, 'utf8'));
};
