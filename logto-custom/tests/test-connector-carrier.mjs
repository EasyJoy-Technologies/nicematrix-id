// Standalone tests for logto-custom/connectors/connector-carrier (no Logto install):
// @logto/connector-kit and zod are stubbed in a temp node_modules; the connector
// source is copied next to them. Signature checks re-derive the backend
// service-auth string (apps/api/src/shared/service-auth.js) independently.
//
// Run: node logto-custom/tests/test-connector-carrier.mjs   (also via tests/run.sh)
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'nmx-carrier-'));
const kit = path.join(dir, 'node_modules/@logto/connector-kit');
const zod = path.join(dir, 'node_modules/zod');
mkdirSync(kit, { recursive: true });
mkdirSync(zod, { recursive: true });
writeFileSync(path.join(kit, 'package.json'), '{"name":"@logto/connector-kit","type":"module","main":"index.js"}');
writeFileSync(path.join(kit, 'index.js'), `
export class ConnectorError extends Error { constructor(code, data) { super(typeof data === 'string' ? data : code); this.code = code; this.data = data; } }
export const ConnectorErrorCodes = { General: 'general', InvalidConfig: 'invalid_config', InvalidResponse: 'invalid_response',
  InvalidRequestParameters: 'invalid_request_parameters', InsufficientRequestParameters: 'insufficient_request_parameters',
  SocialAuthCodeInvalid: 'social_auth_code_invalid', AuthorizationFailed: 'authorization_failed' };
export const ConnectorPlatform = { Universal: 'Universal' };
export const ConnectorType = { Social: 'Social' };`);
writeFileSync(path.join(zod, 'package.json'), '{"name":"zod","type":"module","main":"index.js"}');
writeFileSync(path.join(zod, 'index.js'), 'export const z = { object: () => ({ passthrough: () => ({ kind: "passthrough" }) }) };');
cpSync(path.join(here, '../connectors/connector-carrier'), path.join(dir, 'connector-carrier'), { recursive: true });

const { default: create, defaultMetadata } = await import(pathToFileURL(path.join(dir, 'connector-carrier/lib/index.js')));
const { brokerOriginFor } = await import(pathToFileURL(path.join(dir, 'connector-carrier/lib/broker.js')));
const connector = await create({ getConfig: async () => ({}) });

let pass = 0;
const test = async (name, fn) => { await fn(); pass += 1; console.log(`  ✓ ${name}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const lc = (claims) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const KEY = 'C'.repeat(48);

await test('metadata: social carrier target, no config fields', () => {
  assert.equal(connector.type, 'Social');
  assert.equal(defaultMetadata.target, 'carrier');
  assert.equal(defaultMetadata.id, 'nicematrix-carrier');
  assert.deepEqual(defaultMetadata.formItems, []);
  assert.ok(defaultMetadata.name.en && defaultMetadata.name['zh-CN']);
  // Traditional Chinese UIs resolve to zh-TW or zh-HK; a missing key falls back to English.
  assert.equal(defaultMetadata.name['zh-TW'], '本機號碼');
  assert.equal(defaultMetadata.name['zh-HK'], '本機號碼');
});

await test('authorization: fixed region allowlist, launch context forwarded, session stored', async () => {
  delete process.env.NICEMATRIX_CARRIER_BROKER_URLS;
  let session;
  const url = await connector.getAuthorizationUri(
    { state: 'se_1', redirectUri: 'https://id/callback/c', scope: lc({ region: 'cn' }) },
    async (s) => { session = s; });
  assert.ok(url.startsWith('https://apiv3.ej-mobile.cn/v1/carrier/broker/start?lc='));
  assert.deepEqual(session, { state: 'se_1', redirectUri: 'https://id/callback/c', region: 'cn' });
  await assert.rejects(connector.getAuthorizationUri({ state: 's', redirectUri: 'r' }, async () => {}), /launch context missing/);
  await assert.rejects(connector.getAuthorizationUri({ state: 's', redirectUri: 'r', scope: lc({ region: 'intl' }) }, async () => {}), /no carrier broker/);
});

await test('broker override: https origins only; malformed JSON never widens the list', () => {
  const env = { NICEMATRIX_CARRIER_BROKER_URLS: '{"cn":"https://api-staging.nicematrix.com","x":"http://evil.test","y":"https://a.test/path"}' };
  assert.equal(brokerOriginFor('cn', env), 'https://api-staging.nicematrix.com');
  assert.equal(brokerOriginFor('x', env), undefined);
  assert.equal(brokerOriginFor('y', env), undefined);
  assert.equal(brokerOriginFor('cn', { NICEMATRIX_CARRIER_BROKER_URLS: '{bad' }), undefined);
});

const session = async () => ({ state: 'se_state', region: 'cn' });

await test('user info: error callback → AuthorizationFailed (never calls the Backend)', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  await assert.rejects(connector.getUserInfo({ error: 'access_denied', error_description: 'user_cancelled' }, session),
    (e) => e.code === 'authorization_failed');
});

await test('user info: signed consume (backend string), one retry with the same request id', async () => {
  process.env.INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME = KEY;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return new Response(JSON.stringify({ ok: true, data: { id: 'att_11111111-2222-3333-4444-555555555555', phone: '8613800138000', raw: { provider: 'mock' } } }), { status: 200 });
  };
  const info = await connector.getUserInfo({ code: 'CODE', redirectUri: 'x' }, session);
  assert.deepEqual(info, { id: 'att_11111111-2222-3333-4444-555555555555', phone: '8613800138000', rawData: { provider: 'mock' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://apiv3.ej-mobile.cn/v1/internal/carrier/consume');
  const [a, b] = calls.map((c) => JSON.parse(c.init.body));
  assert.deepEqual(a, b, 'same body (same consume_request_id) on retry');
  assert.deepEqual(Object.keys(a).sort(), ['consume_request_id', 'result_code', 'state']);
  assert.equal(a.state, 'se_state');
  assert.notEqual(calls[0].init.headers['X-NM-Nonce'], calls[1].init.headers['X-NM-Nonce'], 'fresh nonce');
  const h = calls[1].init.headers;
  const expected = createHmac('sha256', KEY).update(['POST', '/v1/internal/carrier/consume', h['X-NM-Service'],
    h['X-NM-Timestamp'], h['X-NM-Nonce'], createHash('sha256').update(calls[1].init.body).digest('hex')].join('\n')).digest('hex');
  assert.equal(h['X-NM-Signature'], expected);
  assert.equal(h['X-NM-Service'], 'nicematrix-logto');
});

await test('user info: replay → SocialAuthCodeInvalid; "+86" or bad id → InvalidResponse; no key → InvalidConfig', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: { failure_class: 'attempt_replayed' } }), { status: 409 });
  await assert.rejects(connector.getUserInfo({ code: 'C' }, session), (e) => e.code === 'social_auth_code_invalid');
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: { id: 'att_11111111-2222-3333-4444-555555555555', phone: '+8613800138000' } }), { status: 200 });
  await assert.rejects(connector.getUserInfo({ code: 'C' }, session), (e) => e.code === 'invalid_response');
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: { id: 'phone-8613800138000', phone: '8613800138000' } }), { status: 200 });
  await assert.rejects(connector.getUserInfo({ code: 'C' }, session), (e) => e.code === 'invalid_response');
  delete process.env.INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME;
  await assert.rejects(connector.getUserInfo({ code: 'C' }, session), (e) => e.code === 'invalid_config');
  await assert.rejects(connector.getUserInfo({}, session), (e) => e.code === 'invalid_request_parameters');
});

console.log(`connector-carrier: ${pass} passed`);
