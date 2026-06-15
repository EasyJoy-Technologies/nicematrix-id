import { object, string } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import {
  verificationRecordDataGuard,
  buildVerificationRecord,
} from '#src/routes/experience/classes/verifications/index.js';

import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

/**
 * [NiceMatrix override] admin-user/verification-records.ts
 *
 * WHY: Logto validates a "sensitive-operation verification record" only inside
 * the Account API opaque-token middleware (`koa-oidc-auth.ts ->
 * getVerificationRecordResultById`) and the experience flows. There is NO
 * Management API route that lets a trusted M2M caller confirm that a given
 * verification record is "owned by user X and verified". The NiceMatrix backend
 * needs exactly that: native third-party bind/unbind
 * (`POST/DELETE /v1/me/identities/{wechat|alipay|qq}`) must be gated behind the
 * same step-up second-factor that Logto's own web-flow binding already enforces.
 * Without this route those native endpoints had NO second-factor, so a stolen
 * (device/IP-unbound) native access token could silently bind an attacker's own
 * social account onto the victim — a persistent backdoor that surviving a
 * password change or MFA would not stop.
 *
 * WHAT: a read-only assertion. The backend mints NOTHING here; the client mints
 * the verification record against Logto with the user's OWN account-scoped token
 * (password / email-OTP / phone-OTP / redo social / passkey), then passes the
 * opaque `recordId` to the backend, which asks this route "is this record valid,
 * verified, and owned by :userId?". 204 = yes; 422 = no.
 *
 * The decision logic is byte-for-byte the same as upstream
 * `getVerificationRecordResultById` (koa-oidc-auth.ts): find the active record,
 * require `record.userId === :userId`, parse `record.data`, build the
 * verification instance, return its `isVerified`. Accepting ANY verified record
 * type (not only password) is deliberate — it keeps social-only users (no
 * password / email / phone) able to step up via redo-social or passkey, exactly
 * as Logto's web binding does.
 *
 * SAFETY:
 *   - Mounted on managementRouter, which already enforces M2M auth +
 *     `PredefinedScope.All` (koa-auth). No extra auth code; an unauthenticated /
 *     wrong-scope caller is rejected before this handler.
 *   - `recordId` is an opaque, single-use, 10-minute handle. This route is
 *     read-only, has zero side effects, and returns NO PII — only 204/422.
 *   - A record belonging to another user, expired, malformed, or unverified all
 *     collapse to 422 (no oracle distinguishing "wrong owner" from "unverified").
 *
 * Route: POST /api/users/:userId/verification-records/assert  body { recordId }
 *   204 — record is active, verified, and owned by :userId
 *   422 — record missing / expired / wrong owner / malformed / not verified
 *   400 — missing/empty recordId (koa-guard)
 */
export default function adminUserVerificationRecordsRoutes<T extends ManagementApiRouter>(
  ...[router, { queries, libraries }]: RouterInitArgs<T>
) {
  router.post(
    '/users/:userId/verification-records/assert',
    koaGuard({
      params: object({ userId: string().min(1) }),
      body: object({ recordId: string().min(1) }),
      status: [204, 400, 422],
    }),
    async (ctx) => {
      const { userId } = ctx.guard.params;
      const { recordId } = ctx.guard.body;

      const record = await queries.verificationRecords.findActiveVerificationRecordById(recordId);

      // Not found / expired / not owned by this user → indistinguishable 422.
      if (!record || record.userId !== userId) {
        throw new RequestError({ code: 'verification_record.not_found', status: 422 });
      }

      const result = verificationRecordDataGuard.safeParse({
        ...record.data,
        id: record.id,
      });
      if (!result.success) {
        throw new RequestError({ code: 'verification_record.not_found', status: 422 });
      }

      const instance = buildVerificationRecord(libraries, queries, result.data);
      if (!instance.isVerified) {
        throw new RequestError({ code: 'verification_record.not_found', status: 422 });
      }

      ctx.status = 204;

      // NOTE: deliberately do NOT call next(). Mirrors by-identity.ts — koa-guard
      // response validation runs in the wrapper after this handler returns,
      // independent of next(); skipping next() avoids any chance of a later
      // `/users/:userId/...` route cascading over the 204.
    }
  );
}
