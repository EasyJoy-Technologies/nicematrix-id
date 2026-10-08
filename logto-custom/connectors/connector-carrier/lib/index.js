/**
 * NiceMatrix Carrier Connector — 本机号码一键登录 (carrier one-tap login).
 *
 * NOT a Logto built-in. A Social connector (target `carrier`) whose only job is
 * to bring a phone number the cn Backend ALREADY verified with the carrier into
 * the standard Logto Experience (identify / register / MFA / PostSignIn):
 *
 *   getAuthorizationUri  scope = launch context signed by the Logto Core override
 *                        (core/src/libraries/carrier-launch-context.ts) →
 *                        <cn Broker>/v1/carrier/broker/start?lc=<JWT>
 *   getUserInfo          error callback → AuthorizationFailed (the Experience
 *                        override handles it first); otherwise redeem the
 *                        one-time result code at the Backend and return
 *                        { id: "att_<attempt>" (unique per sign-in), phone: "86…" }
 *
 * Holds NO provider credentials; its two env inputs live in the Logto container,
 * never in the (Console-visible) connector config:
 *   INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME   service-auth purpose key (strict)
 *   NICEMATRIX_CARRIER_BROKER_URLS              optional region → origin override (staging)
 *   NICEMATRIX_CARRIER_SERVICE_ID               optional caller id (default nicematrix-logto)
 * Plan: nicematrix-backend docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md §5.1 / §9.
 */
import {
  ConnectorError,
  ConnectorErrorCodes,
  ConnectorPlatform,
  ConnectorType,
} from '@logto/connector-kit';
import { z } from 'zod';

import { brokerOriginFor, decodeLaunchContext } from './broker.js';
import { consumeResultCode } from './consume.js';

const logtoPhoneRegex = /^86\d{11}$/;
const attemptIdRegex = /^att_[\da-f-]{36}$/;

export const defaultMetadata = {
  id: 'nicematrix-carrier',
  target: 'carrier',
  platform: ConnectorPlatform.Universal,
  name: { en: 'This phone number', 'zh-CN': '本机号码', 'zh-TW': '本機號碼', 'zh-HK': '本機號碼' },
  logo: './logo.svg',
  logoDark: './logo.svg',
  description: {
    en: 'NiceMatrix carrier one-tap login (China mainland). Verifies the device phone number through the carrier; not a Logto built-in.',
    'zh-CN': 'NiceMatrix 本机号码一键登录（中国大陆）。由运营商验证本机号码；非 Logto 内置。',
    'zh-TW': 'NiceMatrix 本機號碼一鍵登入（中國大陸）。由電信業者驗證本機號碼；非 Logto 內建。',
  },
  readme: './README.md',
  formItems: [],
};

// No configurable fields: every secret is container env (see header).
const configGuard = z.object({}).passthrough();

const fail = (code, message) => new ConnectorError(code, message);

const getAuthorizationUri = async ({ state, redirectUri, scope }, setSession) => {
  const claims = scope ? decodeLaunchContext(scope) : undefined;

  if (!claims) {
    throw fail(ConnectorErrorCodes.InsufficientRequestParameters, 'carrier launch context missing');
  }

  const origin = brokerOriginFor(claims.region);

  if (!origin) {
    throw fail(ConnectorErrorCodes.InvalidConfig, `no carrier broker for region "${String(claims.region)}"`);
  }

  await setSession({ state, redirectUri, region: claims.region });

  return `${origin}/v1/carrier/broker/start?lc=${encodeURIComponent(scope)}`;
};

const getUserInfo = async (data, getSession) => {
  const input = data ?? {};

  // Standard OAuth error callback from the Broker (cancel / provider failure).
  // The Experience override normally short-circuits before calling verify.
  if (typeof input.error === 'string') {
    throw fail(ConnectorErrorCodes.AuthorizationFailed, String(input.error_description ?? input.error));
  }

  if (typeof input.code !== 'string' || !input.code) {
    throw fail(ConnectorErrorCodes.InvalidRequestParameters, 'carrier result code missing');
  }

  const session = await getSession();
  const origin = brokerOriginFor(session?.region);

  if (typeof session?.state !== 'string' || !origin) {
    throw fail(ConnectorErrorCodes.General, 'carrier connector session missing');
  }

  const key = (process.env.INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME ?? '').trim();

  if (!key) {
    throw fail(ConnectorErrorCodes.InvalidConfig, 'INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME is not configured');
  }

  const result = await consumeResultCode({
    origin,
    resultCode: input.code,
    state: session.state,
    key,
    service: (process.env.NICEMATRIX_CARRIER_SERVICE_ID ?? '').trim() || 'nicematrix-logto',
  });

  if (!result.ok) {
    throw fail(
      result.status === 409 ? ConnectorErrorCodes.SocialAuthCodeInvalid : ConnectorErrorCodes.General,
      `carrier consume failed: ${result.reason}`
    );
  }

  const { id, phone, raw } = result.data ?? {};

  // Logto storage format (no "+"): a "+86…" value would create a second user
  // for a number already stored as "86…" (plan §1.4 / §9.1).
  if (!attemptIdRegex.test(String(id)) || !logtoPhoneRegex.test(String(phone))) {
    throw fail(ConnectorErrorCodes.InvalidResponse, 'carrier consume returned an unexpected shape');
  }

  return { id, phone, rawData: raw && typeof raw === 'object' ? raw : {} };
};

// No connector config is read (see header), so the injected getConfig is unused.
const createCarrierConnector = async () => ({
  metadata: defaultMetadata,
  type: ConnectorType.Social,
  configGuard,
  getAuthorizationUri,
  getUserInfo,
});

export default createCarrierConnector;
