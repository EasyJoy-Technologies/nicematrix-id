'use strict';

/**
 * NiceMatrix override unit test: admin-user/verification-records assert route.
 *
 * Like test-by-identity.js, the route file is TypeScript with Logto `#src/`
 * aliases + zod guards we cannot trivially compile standalone. So this test
 * re-implements the handler's PURE decision logic against the SAME contract the
 * backend depends on, and asserts:
 *
 *   - active + owned + verified record        → 204
 *   - record owned by a DIFFERENT user        → 422 (no owner oracle)
 *   - missing / expired record (find → null)  → 422
 *   - malformed record.data (guard fails)     → 422
 *   - active + owned but NOT verified          → 422
 *   - missing recordId                          → 400 (koa-guard, never queries)
 *
 * The exact 422 collapse (wrong-owner == unverified == missing) is the security
 * property: a caller cannot use the route as an oracle to learn whether a record
 * id exists or whom it belongs to. The real koa wiring + zod guard + the
 * upstream `buildVerificationRecord.isVerified` are exercised by the id-staging
 * M2M smoke (documented in the deploy notes), not here.
 *
 * Run: node logto-custom/tests/test-verification-records.js
 */

const assert = require('node:assert/strict');

// Pure handler logic extracted from verification-records.ts. The three injected
// fns mirror the upstream primitives:
//   findActiveVerificationRecordById(id) -> record | null   (expired -> null)
//   parseData(record)                    -> { success }     (zod safeParse)
//   buildIsVerified(record)              -> boolean         (instance.isVerified)
async function assertRecord(userId, recordId, deps) {
  // koa-guard: body { recordId: string().min(1) } — empty/missing -> 400.
  if (!recordId) {
    return { status: 400, body: { code: 'guard.invalid_input' } };
  }
  const record = await deps.find(recordId);
  if (!record || record.userId !== userId) {
    return { status: 422, body: { code: 'verification_record.not_found' } };
  }
  if (!deps.parseOk(record)) {
    return { status: 422, body: { code: 'verification_record.not_found' } };
  }
  if (!deps.isVerified(record)) {
    return { status: 422, body: { code: 'verification_record.not_found' } };
  }
  return { status: 204 };
}

(async () => {
  const baseDeps = {
    find: async (id) => (id === 'sens_active' ? { id, userId: 'user-A', data: { type: 'Password' } } : null),
    parseOk: () => true,
    isVerified: () => true,
  };

  // 1. active + owned + verified → 204
  {
    const r = await assertRecord('user-A', 'sens_active', baseDeps);
    assert.equal(r.status, 204);
  }

  // 2. record owned by a different user → 422
  {
    const r = await assertRecord('user-B', 'sens_active', baseDeps);
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'verification_record.not_found');
  }

  // 3. missing / expired record (find → null) → 422
  {
    const r = await assertRecord('user-A', 'sens_gone', baseDeps);
    assert.equal(r.status, 422);
  }

  // 4. malformed record.data (zod guard fails) → 422
  {
    const r = await assertRecord('user-A', 'sens_active', { ...baseDeps, parseOk: () => false });
    assert.equal(r.status, 422);
  }

  // 5. active + owned but NOT verified → 422
  {
    const r = await assertRecord('user-A', 'sens_active', { ...baseDeps, isVerified: () => false });
    assert.equal(r.status, 422);
  }

  // 6. missing recordId → 400, never queries
  {
    let queried = false;
    const r = await assertRecord('user-A', '', {
      ...baseDeps,
      find: async () => { queried = true; return null; },
    });
    assert.equal(r.status, 400);
    assert.equal(queried, false, 'must not query the record store when recordId is empty');
  }

  // 7. any verified record TYPE is accepted (social-only parity): a Social record
  //    owned + verified → 204 (not only Password).
  {
    const deps = {
      find: async (id) => (id === 'sens_social' ? { id, userId: 'user-A', data: { type: 'Social' } } : null),
      parseOk: () => true,
      isVerified: () => true,
    };
    const r = await assertRecord('user-A', 'sens_social', deps);
    assert.equal(r.status, 204);
  }

  console.log('test-verification-records: all assertions passed (7 cases)');
})().catch((e) => {
  console.error('test-verification-records FAILED:', e);
  process.exit(1);
});
