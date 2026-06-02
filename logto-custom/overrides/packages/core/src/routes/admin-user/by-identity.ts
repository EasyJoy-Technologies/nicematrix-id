import { object, string } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

/**
 * [NiceMatrix override] admin-user/by-identity.ts
 *
 * WHY: Logto's Management API exposes user search only over scalar columns
 * (id / primaryEmail / primaryPhone / username / name) — NOT the `identities`
 * jsonb column. The internal query `findUserByIdentity(target, userId)`
 * (queries/user.ts) already does the exact `identities #>> '{target,userId}'`
 * lookup the experience/account flows use, but it was never surfaced as a
 * Management API route.
 *
 * The NiceMatrix backend needs this reverse lookup to make the cross-region
 * shared Logto user store the ONE source of truth for native social login
 * (wechat/alipay/qq). Without it each region kept a local `social_identity`
 * ledger that split-brained ("register in region A, login in region B" missed
 * → duplicate account + 502). This route lets BOTH region backends ask the one
 * Logto truth directly, over the same M2M Management API they already use.
 *
 * SAFETY:
 *   - Mounted on the managementRouter, which enforces M2M auth + the
 *     `PredefinedScope.All` scope (koa-auth). No extra auth code needed; an
 *     unauthenticated / wrong-scope caller is rejected before this handler.
 *   - `target` is allow-listed to the known social targets, so an arbitrary
 *     jsonb key can never be probed.
 *   - Read-only. Returns only the user id (+ minimal fields the backend needs
 *     to skip a follow-up GET). No PII beyond name/avatar already returned by
 *     the existing /users routes.
 *   - Registered BEFORE `/users/:userId` (basics.ts) so the literal path
 *     segment `by-identity` is never captured as a `:userId`. (Real Logto ids
 *     are 12-char nanoids, never the literal string, so this is belt-and-braces.)
 *
 * Route: GET /api/users/by-identity?target=<wechat|alipay|qq|apple|azuread>&userId=<value>
 *   200 { id, name, avatar } on hit
 *   404 { } (RequestError user.identity_not_exist) on miss
 *   400 on unknown/empty target (RequestError request.invalid_input)
 */

// Bare Logto identity targets the backend ever reverse-looks-up. Guards the
// jsonb key against anything unexpected.
const allowedTargets = new Set(['wechat', 'alipay', 'qq', 'apple', 'azuread']);

export default function adminUserByIdentityRoutes<T extends ManagementApiRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  const {
    users: { findUserByIdentity },
  } = queries;

  router.get(
    '/users/by-identity',
    koaGuard({
      query: object({
        target: string().min(1).max(32),
        userId: string().min(1).max(512),
      }),
      response: object({
        id: string(),
        name: string().nullable(),
        avatar: string().nullable(),
      }),
      status: [200, 400, 404],
    }),
    async (ctx) => {
      const { target, userId } = ctx.guard.query;

      if (!allowedTargets.has(target)) {
        throw new RequestError({
          code: 'request.invalid_input',
          status: 400,
          details: `Unsupported identity target: ${target}`,
        });
      }

      const user = await findUserByIdentity(target, userId);

      if (!user) {
        throw new RequestError({ code: 'user.identity_not_exist', status: 404 });
      }

      ctx.body = {
        id: user.id,
        name: user.name ?? null,
        avatar: user.avatar ?? null,
      };

      // IMPORTANT: do NOT call next(). koa-router also matches `by-identity`
      // against the later `/users/:userId` route (registered in basics.ts);
      // cascading via next() would run findUserById('by-identity') and
      // overwrite this 200 with a 404 entity.not_found. The miss/400 branches
      // throw before reaching here, so only the hit path needed this guard.
      // koa-guard's response validation runs in the wrapper after this handler
      // returns, independent of next().
    }
  );
}
