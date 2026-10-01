/**
 * Broker endpoints by region — a FIXED allowlist (plan §5.5). A region never
 * comes from the browser: it is read from the launch context Logto signed from
 * its own interaction. Default: cn → https://apiv3.ej-mobile.cn.
 *
 * Staging overrides via container env (JSON object region → https origin):
 *   NICEMATRIX_CARRIER_BROKER_URLS='{"cn":"https://api-staging.nicematrix.com"}'
 */

const DEFAULT_BROKERS = Object.freeze({ cn: 'https://apiv3.ej-mobile.cn' });

export const brokerAllowlist = (env = process.env) => {
  const raw = (env.NICEMATRIX_CARRIER_BROKER_URLS ?? '').trim();
  if (!raw) {
    return DEFAULT_BROKERS;
  }

  try {
    const parsed = JSON.parse(raw);
    const out = {};

    for (const [region, url] of Object.entries(parsed)) {
      const origin = new URL(String(url));

      if (origin.protocol === 'https:' && origin.pathname === '/' && !origin.search) {
        out[region.toLowerCase()] = origin.origin;
      }
    }

    return Object.freeze(out);
  } catch {
    // A malformed override must never widen the allowlist: no broker at all.
    return Object.freeze({});
  }
};

/** Broker origin for a region, or undefined. */
export const brokerOriginFor = (region, env = process.env) =>
  typeof region === 'string' ? brokerAllowlist(env)[region.toLowerCase()] : undefined;

/** Read the (already Logto-signed) launch context payload without re-verifying it. */
export const decodeLaunchContext = (token) => {
  try {
    const [, payload] = String(token).split('.');

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};
