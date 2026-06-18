'use strict';

/**
 * NiceMatrix override unit test: connector-oidc `identitySource` id selection.
 *
 * The connector source is TypeScript with Logto `#src/` aliases + zod guards we
 * cannot trivially compile standalone (same constraint as test-by-identity /
 * test-native-caps). So this test re-implements the PURE id-selection branch
 * extracted verbatim from the override `parseUserInfoFromIdToken` and asserts the
 * contract the fix depends on:
 *
 *   - identitySource 'sub' (default) + sub present  -> id = sub          (upstream parity)
 *   - identitySource omitted (=> 'sub') + sub present -> id = sub        (default parity)
 *   - identitySource 'oid' + oid present            -> id = oid          (Microsoft fix)
 *   - identitySource 'oid' + oid MISSING            -> throw (NO silent  -> sub fallback)
 *   - identitySource 'sub' + oid also present       -> id = sub          (oid ignored)
 *
 * The 4th case is the safety core: a silent fallback to sub when oid is absent
 * would mint a DIFFERENT identity id than the migrated records and re-orphan the
 * user — exactly the regression this override exists to prevent. The real zod
 * guard + jwt verify + koa wiring are exercised by the id-staging real-Microsoft
 * login smoke (documented in the deploy notes), not here.
 *
 * Run: node logto-custom/tests/test-oidc-identity-source.js
 */

const assert = require('node:assert/strict');

// Pure selection logic extracted from override index.ts parseUserInfoFromIdToken.
// `identitySource` defaults to 'sub' (mirrors zod `.default('sub')`).
function selectId({ identitySource = 'sub', sub, oid }) {
  const id = identitySource === 'oid' ? oid : sub;
  if (!id) {
    throw new Error(`Cannot find \`${identitySource}\` claim in the ID Token.`);
  }
  return id;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

// 1. default (sub) parity — explicit
check("identitySource 'sub' returns sub", () => {
  assert.equal(selectId({ identitySource: 'sub', sub: 'S123', oid: 'O999' }), 'S123');
});

// 2. default (sub) parity — omitted
check('identitySource omitted defaults to sub', () => {
  assert.equal(selectId({ sub: 'S123' }), 'S123');
});

// 3. Microsoft fix — oid selected
check("identitySource 'oid' returns oid", () => {
  assert.equal(
    selectId({ identitySource: 'oid', sub: 'AAAA-pairwise', oid: '00000000-0000-0000-f6a2-d4fcbb835d1a' }),
    '00000000-0000-0000-f6a2-d4fcbb835d1a'
  );
});

// 4. SAFETY: oid requested but missing -> throw, never silent sub fallback
check("identitySource 'oid' with missing oid throws (no silent sub fallback)", () => {
  assert.throws(
    () => selectId({ identitySource: 'oid', sub: 'AAAA-pairwise', oid: undefined }),
    /Cannot find `oid` claim/
  );
});

// 5. sub mode ignores a present oid (no cross-contamination)
check("identitySource 'sub' ignores present oid", () => {
  assert.equal(selectId({ identitySource: 'sub', sub: 'S123', oid: 'O999' }), 'S123');
});

// 6. sub mode with missing sub throws (parity with upstream guard requiring sub)
check("identitySource 'sub' with missing sub throws", () => {
  assert.throws(() => selectId({ identitySource: 'sub', sub: undefined }), /Cannot find `sub` claim/);
});

console.log(`\nAll ${passed} oidc-identity-source assertions passed.`);
