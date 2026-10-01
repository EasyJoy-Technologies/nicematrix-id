/**
 * Redeem the Broker's one-time result code at the cn Backend:
 *   POST <broker>/v1/internal/carrier/consume { result_code, state, consume_request_id }
 *
 * Signed with the NiceMatrix service-auth protocol (backend
 * apps/api/src/shared/service-auth.js), purpose key
 * INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME — strict on both sides:
 *   METHOD \n PATH_WITH_QUERY \n SERVICE \n TIMESTAMP \n NONCE \n sha256hex(body)
 *
 * Budget 5 s; exactly ONE retry on timeout / network error with the SAME
 * consume_request_id (fresh nonce) — the Backend answers a same-id retry within
 * 60 s idempotently (plan §7.6 / NFR-09).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const consumePath = '/v1/internal/carrier/consume';
const timeoutMs = 5000;

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

export const signHeaders = ({ body, key, service, now = Date.now() }) => {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signingString = ['POST', consumePath, service, timestamp, nonce, sha256Hex(body)].join('\n');

  return {
    'Content-Type': 'application/json',
    'X-NM-Service': service,
    'X-NM-Timestamp': timestamp,
    'X-NM-Nonce': nonce,
    'X-NM-Signature': createHmac('sha256', key).update(signingString).digest('hex'),
    'X-NM-Key-Id': sha256Hex(key).slice(0, 8),
  };
};

const post = async (url, body, headers, fetchImpl) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, { method: 'POST', headers, body, redirect: 'error', signal: controller.signal });
    const text = await response.text();
    let json;

    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    return { status: response.status, json };
  } catch (error) {
    return { transportError: error instanceof Error ? error.name : 'Error' };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @returns {Promise<{ ok: true, data: object } | { ok: false, status?: number, reason: string }>}
 */
export const consumeResultCode = async ({
  origin,
  resultCode,
  state,
  key,
  service,
  fetchImpl = fetch,
}) => {
  const body = JSON.stringify({
    result_code: resultCode,
    state,
    consume_request_id: randomBytes(16).toString('hex'),
  });
  const url = origin + consumePath;

  let result = await post(url, body, signHeaders({ body, key, service }), fetchImpl);

  if (result.transportError) {
    result = await post(url, body, signHeaders({ body, key, service }), fetchImpl);
  }

  if (result.transportError) {
    return { ok: false, reason: `transport:${result.transportError}` };
  }

  if (result.status !== 200 || !result.json?.ok) {
    return {
      ok: false,
      status: result.status,
      reason: String(result.json?.error?.failure_class ?? result.json?.error?.reason ?? 'rejected'),
    };
  }

  return { ok: true, data: result.json.data };
};
