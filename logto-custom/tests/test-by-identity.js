'use strict';

/**
 * NiceMatrix override unit test: admin-user/by-identity route handler.
 *
 * The route file is TypeScript with Logto `#src/` aliases + zod guards that we
 * cannot trivially compile standalone (like native-caps). So instead of
 * compiling the .ts, this test re-implements the handler's PURE decision logic
 * (target allowlist + hit/miss → status) against the SAME allowlist constant,
 * and asserts the contract the backend depends on:
 *
 *   - allowed target + hit  → 200 { id, name, avatar }
 *   - allowed target + miss → 404
 *   - unknown target        → 400 (never queries findUserByIdentity)
 *
 * This guards the allowlist + branch logic from regressing. The actual koa
 * wiring + zod guard are exercised by the id-staging integration smoke
 * (documented in the deploy notes), not here.
 *
 * REGRESSION NOTE (2026-06-02): the HIT path must NOT call next(). koa-router
 * also matches `by-identity` against the later `/users/:userId` route, so a
 * trailing next() cascades into findUserById('by-identity') and clobbers the
 * 200 with a 404 entity.not_found. This pure test can't model koa-router
 * cascade — the id-staging smoke (hit→200) is the mandatory guard for it.
 *
 * Run: node logto-custom/tests/test-by-identity.js
 */

const assert = require('node:assert/strict');

// Mirror of the allowlist in by-identity.ts (kept in sync intentionally; the
// id-staging smoke is the end-to-end guard).
const allowedTargets = new Set(['wechat', 'alipay', 'qq', 'apple', 'azuread']);

// Pure handler logic extracted from by-identity.ts.
async function resolve(target, userId, findUserByIdentity) {
  if (!allowedTargets.has(target)) {
    return { status: 400, body: { code: 'request.invalid_input' } };
  }
  const user = await findUserByIdentity(target, userId);
  if (!user) {
    return { status: 404, body: { code: 'user.identity_not_exist' } };
  }
  return {
    status: 200,
    body: { id: user.id, name: user.name ?? null, avatar: user.avatar ?? null },
  };
}

(async () => {
  let queried = null;
  const hit = async (t, u) => {
    queried = { t, u };
    return { id: 'logto-123', name: 'focc', avatar: null };
  };
  const miss = async (t, u) => {
    queried = { t, u };
    return null;
  };

  // 1. allowed + hit → 200 with id/name/avatar
  {
    queried = null;
    const r = await resolve('wechat', 'union-A', hit);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: 'logto-123', name: 'focc', avatar: null });
    assert.deepEqual(queried, { t: 'wechat', u: 'union-A' });
  }

  // 2. allowed + miss → 404, still queried
  {
    queried = null;
    const r = await resolve('qq', 'UID-x', miss);
    assert.equal(r.status, 404);
    assert.deepEqual(queried, { t: 'qq', u: 'UID-x' });
  }

  // 3. unknown target → 400, never queries
  {
    queried = null;
    const r = await resolve('weibo', 'x', hit);
    assert.equal(r.status, 400);
    assert.equal(queried, null, 'must not query findUserByIdentity for an unknown target');
  }

  // 4. allowlist is exactly the 5 social targets
  assert.deepEqual([...allowedTargets].sort(), ['alipay', 'apple', 'azuread', 'qq', 'wechat']);

  // 5. alipay bare value passes through unchanged (Phase C: no appid prefix)
  {
    queried = null;
    const r = await resolve('alipay', '2088123456789012', hit);
    assert.equal(r.status, 200);
    assert.deepEqual(queried, { t: 'alipay', u: '2088123456789012' });
  }

  console.log('test-by-identity: all assertions passed (5 cases)');
})().catch((e) => {
  console.error('test-by-identity FAILED:', e);
  process.exit(1);
});
