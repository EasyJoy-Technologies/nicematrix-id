'use strict';

/**
 * NiceMatrix override unit test: token-exchange multi-resource support.
 *
 * Context (incident 2026-08-06): CN apps run ONE login session against TWO API
 * resources — business (`https://apiv3.ej-mobile.cn`) and self-hosted store
 * (`https://api.nicematrix.com`, prod-1 only). Native logins go through the
 * RFC 8693 token-exchange grant. The override stored a SINGLE `params.resource`
 * on the minted refresh token, so a later
 * `grant_type=refresh_token&resource=<the other one>` failed with
 * `InvalidTarget` ("resource indicator is missing, or unknown"). Clients treated
 * that as a dead session and revoked the grant, producing a re-login loop
 * (nicelist: 53 invalid_target / 15 users / 53 forced re-logins in one day;
 * nicerecorder reproduced it too with 1 user).
 *
 * The grant is already registered with `resource` as a DUPLICABLE parameter
 * (`registerGrants()` -> `getParameterConfig`), so `params.resource` can
 * legitimately be an array; only the handler failed to honour it.
 *
 * The handler itself is TypeScript with Logto `#src/` aliases, oidc-provider
 * deep-imports and a live provider instance — not compilable standalone (same
 * constraint as test-by-identity / test-oidc-identity-source). So this test
 * re-implements the PURE branches extracted verbatim from the override and
 * asserts the contract the fix depends on. The koa wiring, real Grant/RefreshToken
 * models and real `resolveResource` are covered by the id-staging real-token
 * smoke, not here.
 *
 * Cases:
 *   1-4  single resource  -> byte-identical to pre-change behaviour (REGRESSION
 *        guard: this is the path 100% of today's production traffic uses —
 *        618/618 token-exchange calls in the last 30d sent one string)
 *   5-8  multi resource   -> array persisted, primary drives the access token
 *   9-10 resolveResource never receives an array (would silently mint the WRONG
 *        audience via Logto's defaultResource(), which ignores its candidates)
 *   11   secondary registered on the grant (else refresh yields empty scope)
 *   12   unknown secondary fails fast at login, not on a later refresh
 *   13   BaseToken#resourceIndicators semantics for both shapes
 *
 * Run: node logto-custom/tests/test-token-exchange-multi-resource.js
 */

const assert = require('node:assert/strict');

const BIZ = 'https://apiv3.ej-mobile.cn';
const STORE = 'https://api.nicematrix.com';
const UNKNOWN = 'https://not-a-registered-resource.example.com';

// --- Logic extracted verbatim from the override -----------------------------

/** Normalization block: `params.resource` -> string[] (drops empty/non-string). */
function normalizeResources(paramsResource) {
  return (Array.isArray(paramsResource) ? paramsResource : [paramsResource]).filter(
    (value) => typeof value === 'string' && value.length > 0
  );
}

/** Refresh-token `resource` field: array only when >1 was requested. */
function refreshTokenResource(requested) {
  return requested.length > 1 ? requested : requested[0];
}

/**
 * oidc-provider `BaseToken#resourceIndicators` getter, verbatim:
 *   new Set(Array.isArray(this.resource) ? this.resource : [this.resource])
 * This is what `resolve_resource.js` membership-checks on every refresh.
 */
function resourceIndicators(storedResource) {
  return new Set(Array.isArray(storedResource) ? storedResource : [storedResource]);
}

/**
 * oidc-provider `resolve_resource.js` membership check, verbatim:
 *   if (resource && !model.resourceIndicators.has(resource)) throw new InvalidTarget()
 */
function refreshWouldSucceed(storedResource, requestedResource) {
  return resourceIndicators(storedResource).has(requestedResource);
}

/** Secondary-registration loop: which indicators get added to the grant. */
function secondariesFor(requested, primary) {
  return requested.filter((value) => value !== primary);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

// === 1-4. SINGLE RESOURCE: unchanged behaviour (regression guard) ============

check('single string resource -> requested = [value], primary = value', () => {
  const requested = normalizeResources(BIZ);
  assert.deepEqual(requested, [BIZ]);
  assert.equal(requested[0], BIZ);
});

check('single resource -> RT stores a bare STRING (pre-change shape)', () => {
  const requested = normalizeResources(BIZ);
  const stored = refreshTokenResource(requested);
  assert.equal(typeof stored, 'string');
  assert.equal(stored, BIZ);
  // Identical to what the old `resource: params.resource` produced.
  assert.equal(stored, BIZ);
});

check('single resource -> existing single-resource refresh still succeeds', () => {
  const stored = refreshTokenResource(normalizeResources(BIZ));
  assert.equal(refreshWouldSucceed(stored, BIZ), true);
});

check('no resource at all -> requested empty, primary undefined (org/OIDC path)', () => {
  const requested = normalizeResources(undefined);
  assert.deepEqual(requested, []);
  assert.equal(requested[0], undefined);
  assert.equal(refreshTokenResource(requested), undefined);
});

// === 5-8. MULTI RESOURCE: the fix ===========================================

check('two resources -> requested keeps order, primary = first', () => {
  const requested = normalizeResources([BIZ, STORE]);
  assert.deepEqual(requested, [BIZ, STORE]);
  assert.equal(requested[0], BIZ);
});

check('two resources -> RT stores an ARRAY', () => {
  const stored = refreshTokenResource(normalizeResources([BIZ, STORE]));
  assert.ok(Array.isArray(stored));
  assert.deepEqual(stored, [BIZ, STORE]);
});

check('two resources -> refresh works for BOTH (the incident is fixed)', () => {
  const stored = refreshTokenResource(normalizeResources([BIZ, STORE]));
  assert.equal(refreshWouldSucceed(stored, BIZ), true);
  assert.equal(refreshWouldSucceed(stored, STORE), true);
});

check('OLD single-value behaviour would have FAILED the store refresh', () => {
  // Reproduces the production incident: RT minted with only the business
  // resource, client then asks for the store resource.
  const oldStored = BIZ;
  assert.equal(refreshWouldSucceed(oldStored, STORE), false);
  // ...and still succeeds for its own resource, which is why the bug looked
  // like "login works, then randomly logs out".
  assert.equal(refreshWouldSucceed(oldStored, BIZ), true);
});

// === 9-10. resolveResource must NEVER see an array ==========================

check('multi -> resolveResource ctx pins params.resource to the primary', () => {
  const requested = normalizeResources([BIZ, STORE]);
  const primary = requested[0];
  // The proxy substitutes a single value; assert it is never an array, since
  // Logto's defaultResource() ignores the candidates it is handed and returns
  // the tenant default -> wrong audience, silently.
  const seenByResolveResource = requested.length > 1 ? primary : requested[0];
  assert.equal(Array.isArray(seenByResolveResource), false);
  assert.equal(seenByResolveResource, BIZ);
});

check('single -> ctx passed through untouched (no proxy)', () => {
  const requested = normalizeResources(BIZ);
  const usesProxy = requested.length > 1;
  assert.equal(usesProxy, false);
});

// === 11-12. grant registration ==============================================

check('secondary indicators are registered on the grant', () => {
  const requested = normalizeResources([BIZ, STORE]);
  assert.deepEqual(secondariesFor(requested, BIZ), [STORE]);
  // Single-resource requests register nothing extra.
  assert.deepEqual(secondariesFor(normalizeResources(BIZ), BIZ), []);
});

check('unknown secondary fails fast at login (getResourceServerInfo throws)', () => {
  const registered = new Set([BIZ, STORE]);
  const getResourceServerInfo = (indicator) => {
    if (!registered.has(indicator)) {
      throw new Error('InvalidTarget');
    }
    return { scope: '' };
  };
  const requested = normalizeResources([BIZ, UNKNOWN]);
  assert.throws(() => {
    for (const secondary of secondariesFor(requested, BIZ)) {
      getResourceServerInfo(secondary);
    }
  }, /InvalidTarget/);
  // Known secondary does not throw.
  assert.doesNotThrow(() => {
    for (const secondary of secondariesFor(normalizeResources([BIZ, STORE]), BIZ)) {
      getResourceServerInfo(secondary);
    }
  });
});

// === 13. rotation preserves the shape =======================================

check('rotation copies resource verbatim for both shapes', () => {
  // upstream refresh_token grant: `resource: refreshToken.resource`
  const rotate = (stored) => stored;
  const single = refreshTokenResource(normalizeResources(BIZ));
  const multi = refreshTokenResource(normalizeResources([BIZ, STORE]));
  assert.equal(rotate(single), BIZ);
  assert.deepEqual(rotate(multi), [BIZ, STORE]);
  // And both keep working after rotation.
  assert.equal(refreshWouldSucceed(rotate(single), BIZ), true);
  assert.equal(refreshWouldSucceed(rotate(multi), STORE), true);
});

console.log(`\n${passed} checks passed.`);
