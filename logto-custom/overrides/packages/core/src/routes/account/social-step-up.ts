/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * Identity re-verification with the caller's LINKED third-party account (social step-up).
 * Rules and threat model: `libraries/social-step-up.ts`.
 *
 *   POST /api/my-account/verifications/social
 *     { connectorId, state, redirectUri, scope? }
 *     -> 201 { verificationRecordId, authorizationUri, expiresAt }
 *     422 user.identity_not_exists_in_current_user  (caller has no identity for that connector)
 *
 *   POST /api/my-account/verifications/social/verify
 *     { verificationRecordId, connectorData }  -> 200 { verificationRecordId }
 *     404 verification_record.not_found     (missing / expired / owned by someone else)
 *     422 user.social_identity_mismatch      (authorized with a different third-party account;
 *                                              the record is NOT marked verified)
 *
 * The verified record id goes in the `logto-verification-id` header exactly like a password /
 * code record and expires with the same 10-minute window. First-party clients only.
 */
import {
  socialAuthorizationUrlPayloadGuard,
  socialVerificationCallbackPayloadGuard,
  VerificationType,
} from '@logto/schemas';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { getSocialTarget, isLinkedIdentity } from '#src/libraries/social-step-up.js';
import {
  buildVerificationRecordByIdAndType,
  insertVerificationRecord,
  updateVerificationRecord,
} from '#src/libraries/verification.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { SocialVerification } from '#src/routes/experience/classes/verifications/social-verification.js';
import { assertFirstPartyClient } from '#src/utils/assert-first-party-client.js';
import assertThat from '#src/utils/assert-that.js';

import type { UserRouter, RouterInitArgs } from '../types.js';

import { accountApiPrefix } from './constants.js';

export default function socialStepUpRoutes<T extends UserRouter>(
  ...[router, tenantContext]: RouterInitArgs<T>
) {
  const { queries, libraries } = tenantContext;

  router.post(
    `${accountApiPrefix}/verifications/social`,
    koaGuard({
      body: socialAuthorizationUrlPayloadGuard.extend({
        connectorId: z.string(),
        scope: z.string().optional(),
      }),
      response: z.object({
        verificationRecordId: z.string(),
        authorizationUri: z.string(),
        expiresAt: z.string(),
      }),
      status: [201, 400, 401, 403, 404, 422],
    }),
    async (ctx, next) => {
      const { id: userId, clientId } = ctx.auth;
      await assertFirstPartyClient(queries, clientId);
      const { connectorId, ...rest } = ctx.guard.body;

      const target = await getSocialTarget(libraries, connectorId);
      const user = await queries.users.findUserById(userId);
      assertThat(
        target && user.identities[target],
        new RequestError({ code: 'user.identity_not_exists_in_current_user', status: 422 })
      );

      const verification = SocialVerification.create(libraries, queries, connectorId);
      const authorizationUri = await verification.createAuthorizationUrl(
        ctx,
        tenantContext,
        rest,
        'verificationRecord'
      );
      // Unlike upstream `/api/verifications/social`, the record is bound to the caller.
      const { expiresAt } = await insertVerificationRecord(verification, queries, userId);

      ctx.body = {
        verificationRecordId: verification.id,
        authorizationUri,
        expiresAt: new Date(expiresAt).toISOString(),
      };
      ctx.status = 201;

      return next();
    }
  );

  router.post(
    `${accountApiPrefix}/verifications/social/verify`,
    koaGuard({
      body: socialVerificationCallbackPayloadGuard
        .pick({ connectorData: true })
        .extend({ verificationRecordId: z.string() }),
      response: z.object({ verificationRecordId: z.string() }),
      status: [200, 400, 401, 403, 404, 422],
    }),
    async (ctx, next) => {
      const { id: userId, clientId } = ctx.auth;
      await assertFirstPartyClient(queries, clientId);
      const { connectorData, verificationRecordId } = ctx.guard.body;

      const row = await queries.verificationRecords.findActiveVerificationRecordById(
        verificationRecordId
      );
      assertThat(
        row?.userId === userId,
        new RequestError({ code: 'verification_record.not_found', status: 404 })
      );

      const verification = await buildVerificationRecordByIdAndType({
        type: VerificationType.Social,
        id: verificationRecordId,
        queries,
        libraries,
      });
      await verification.verify(ctx, tenantContext, connectorData, 'verificationRecord');

      const target = await getSocialTarget(libraries, verification.connectorId);
      const providerUserId = verification.socialUserInfo?.id;
      assertThat(
        target &&
          providerUserId &&
          (await isLinkedIdentity(queries, userId, target, providerUserId)),
        new RequestError({ code: 'user.social_identity_mismatch', status: 422 })
      );

      await updateVerificationRecord(verification, queries);
      ctx.body = { verificationRecordId };

      return next();
    }
  );
}
